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


__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
