import base64
import os
import shutil
import subprocess
from aiohttp import web
import folder_paths
from server import PromptServer

from .multilora_node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"


@PromptServer.instance.routes.post("/focuspp/save_pi13_as")
async def save_pi13_as(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")
        folder_type = data.get("type", "temp")
        suggested_name = data.get("suggestedName", "pi13_image.png")
        image_base64 = data.get("imageBase64", "")

        src_path = None
        if filename:
            base_dir = folder_paths.get_directory_by_type(folder_type)
            if not base_dir:
                base_dir = folder_paths.get_temp_directory()
            candidate = os.path.join(base_dir, subfolder, filename) if subfolder else os.path.join(base_dir, filename)
            if os.path.isfile(candidate):
                src_path = candidate

        if not src_path and not image_base64:
            return web.json_response({"error": "Source image not found"}, status=404)

        # Abrir diálogo nativo de macOS ("Guardar como...") al frente de la ventana actual
        safe_name = suggested_name.replace('"', '')
        apple_script = f'''
        tell application (path to frontmost application as text)
            POSIX path of (choose file name with prompt "Guardar imagen de pi13 como:" default name "{safe_name}")
        end tell
        '''
        proc = subprocess.run(
            ["osascript", "-e", apple_script],
            capture_output=True,
            text=True
        )

        if proc.returncode != 0:
            # Usuario canceló la ventana
            return web.json_response({"saved": False, "cancelled": True})

        dest_path = proc.stdout.strip()
        if not dest_path.lower().endswith(".png"):
            dest_path += ".png"

        if src_path:
            shutil.copy2(src_path, dest_path)
        else:
            raw_b64 = image_base64.split(",", 1)[-1]
            with open(dest_path, "wb") as f:
                f.write(base64.b64decode(raw_b64))

        return web.json_response({
            "saved": True,
            "filename": os.path.basename(dest_path),
            "path": dest_path
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


import csv
import io


def _get_autocomplete_csv_path():
    custom_nodes_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
    candidates = [
        os.path.join(custom_nodes_dir, "ComfyUI-Autocomplete-Plus", "data", "danbooru_tags.csv"),
        os.path.join(custom_nodes_dir, "comfyui-autocomplete-plus", "data", "danbooru_tags.csv"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return candidates[0]


def _split_custom_and_base_lines(lines):
    """
    Separa el encabezado personalizado (antes de '1girl,0,4974288') del catálogo base de Danbooru.
    """
    header = "tag,category,count,alias"
    start_idx = 1 if (lines and lines[0].strip().lower().startswith("tag,category,count,alias")) else 0
    split_idx = len(lines)

    for i in range(start_idx, len(lines)):
        stripped = lines[i].strip()
        if stripped.startswith("1girl,0,4974288") or stripped.startswith("1girl,0,"):
            split_idx = i
            break

    custom_lines = [l.strip("\r\n") for l in lines[start_idx:split_idx] if l.strip()]
    base_lines = [l.strip("\r\n") for l in lines[split_idx:] if l.strip()]
    return header, custom_lines, base_lines


def _parse_csv_lines_to_items(custom_lines):
    items = []
    for raw_line in custom_lines:
        if not raw_line.strip():
            continue
        try:
            reader = csv.reader([raw_line], skipinitialspace=True)
            cols = next(reader, [])
            if len(cols) >= 4:
                tag = cols[0].strip()
                category = cols[1].strip() or "0"
                count = cols[2].strip() or "9999999"
                alias = ",".join(c.strip() for c in cols[3:] if c.strip())
                items.append({
                    "tag": tag,
                    "category": category,
                    "count": count,
                    "alias": alias
                })
            elif len(cols) >= 1:
                items.append({
                    "tag": cols[0].strip(),
                    "category": cols[1].strip() if len(cols) > 1 else "0",
                    "count": cols[2].strip() if len(cols) > 2 else "9999999",
                    "alias": ""
                })
        except Exception:
            continue
    return items


def _format_item_to_csv_line(item):
    tag = str(item.get("tag", "")).strip()
    if not tag:
        return ""
    category = str(item.get("category", "0")).strip() or "0"
    count = str(item.get("count", "9999999")).strip() or "9999999"
    try:
        int(count)
    except ValueError:
        count = "9999999"
    alias = str(item.get("alias", "")).strip()

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="")
    writer.writerow([tag, category, count, alias])
    return buf.getvalue()


@PromptServer.instance.routes.get("/focuspp/autocomplete_data")
async def get_autocomplete_data(_request):
    csv_path = _get_autocomplete_csv_path()
    if not os.path.isfile(csv_path):
        return web.json_response({"error": f"No se encontró el archivo CSV en: {csv_path}"}, status=404)

    try:
        with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()

        _header, custom_lines, base_lines = _split_custom_and_base_lines(lines)
        items = _parse_csv_lines_to_items(custom_lines)

        return web.json_response({
            "filePath": csv_path,
            "items": items,
            "rawCustomCsv": "\n".join(custom_lines),
            "baseCount": len(base_lines)
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.post("/focuspp/autocomplete_data")
async def save_autocomplete_data(request):
    csv_path = _get_autocomplete_csv_path()
    if not os.path.isfile(csv_path):
        return web.json_response({"error": f"No se encontró el archivo CSV en: {csv_path}"}, status=404)

    try:
        payload = await request.json()
        mode = payload.get("mode", "items")

        with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
            existing_lines = f.readlines()

        header, _old_custom, base_lines = _split_custom_and_base_lines(existing_lines)

        new_custom_lines = []
        if mode == "raw":
            raw_text = str(payload.get("rawCustomCsv", ""))
            parsed_from_raw = _parse_csv_lines_to_items(raw_text.splitlines())
            for it in parsed_from_raw:
                line_str = _format_item_to_csv_line(it)
                if line_str:
                    new_custom_lines.append(line_str)
        else:
            items = payload.get("items", [])
            for it in items:
                line_str = _format_item_to_csv_line(it)
                if line_str:
                    new_custom_lines.append(line_str)

        # Crear respaldo automático antes de sobrescribir
        backup_path = csv_path + ".bak"
        try:
            shutil.copy2(csv_path, backup_path)
        except Exception:
            pass

        all_output_lines = [header] + new_custom_lines + base_lines
        with open(csv_path, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(all_output_lines) + "\n")

        updated_items = _parse_csv_lines_to_items(new_custom_lines)
        return web.json_response({
            "saved": True,
            "filePath": csv_path,
            "items": updated_items,
            "rawCustomCsv": "\n".join(new_custom_lines),
            "customCount": len(updated_items),
            "baseCount": len(base_lines)
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
