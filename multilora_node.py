import os
import json
import struct
import comfy.sd
import comfy.utils
import folder_paths
from server import PromptServer
from aiohttp import web
import asyncio


_LORA_META_CACHE = {}


def inspect_safetensors_header(lora_path):
    """Lee únicamente el encabezado JSON del .safetensors (< 0.5ms) con caché en RAM."""
    if not lora_path or not os.path.exists(lora_path):
        return {
            "found": False, 
            "arch": "Desconocido",
            "archFamily": "",
            "rank": None,
            "alpha": None,
            "ratio": None,
            "strengthHint": "",
            "resolution": "",
            "steps": "",
            "baseModel": "",
            "triggers": "",
            "summary": "Archivo no encontrado.",
        }

    try:
        mtime = os.path.getmtime(lora_path)
        cache_key = (lora_path, mtime)
        if cache_key in _LORA_META_CACHE:
            return _LORA_META_CACHE[cache_key]
    except Exception:
        cache_key = None

    if not lora_path.lower().endswith(".safetensors"):
        res = {
            "found": True,
            "arch": "Otro formato",
            "archFamily": "",
            "rank": None,
            "alpha": None,
            "ratio": None,
            "strengthHint": "",
            "resolution": "",
            "steps": "",
            "baseModel": "",
            "triggers": "",
            "summary": "Solo archivos .safetensors soportan lectura rápida de header.",
        }
        return res

    try:
        with open(lora_path, "rb") as f:
            header_size = struct.unpack("<Q", f.read(8))[0]
            header_json = f.read(header_size).decode("utf-8", errors="replace")
            header = json.loads(header_json)

        metadata = header.get("__metadata__", {}) or {}
        tensor_keys = [k for k in header.keys() if k != "__metadata__"]

        # 1. Detectar Rank (dim) y Alpha
        rank = None
        alpha = None

        raw_dim = metadata.get("ss_network_dim") or metadata.get("network_dim") or metadata.get("lora_rank")
        if raw_dim is not None:
            try:
                rank = int(float(raw_dim))
            except Exception:
                pass

        raw_alpha = metadata.get("ss_network_alpha") or metadata.get("network_alpha") or metadata.get("lora_alpha")
        if raw_alpha is not None:
            try:
                alpha = float(raw_alpha)
            except Exception:
                pass

        # Si el Rank no viene en __metadata__, inferirlo de la forma (shape) del primer tensor lora_down / lora_A
        if rank is None:
            for k in tensor_keys:
                kl = k.lower()
                if kl.endswith(("lora_down.weight", "lora_a.weight", "lora_a.default.weight", "lora.down.weight")):
                    shape = header.get(k, {}).get("shape")
                    if isinstance(shape, list) and len(shape) >= 2 and isinstance(shape[0], int) and 1 <= shape[0] <= 512:
                        rank = shape[0]
                        break

        # Si alpha no viene en __metadata__, buscar tensores .alpha escalares o asumir rank
        ratio = None
        strength_hint = ""
        if rank:
            effective_alpha = alpha if alpha is not None else float(rank)
            ratio = round(effective_alpha / float(rank), 2)
            if rank >= 64 and ratio >= 0.75:
                strength_hint = "Alto/Agresivo (suele saturar rápido > 0.8)"
            elif ratio < 0.5:
                strength_hint = "Suave (admite pesos 0.8 - 1.2)"
            elif rank <= 16:
                strength_hint = "Ligero / Compacto"
            else:
                strength_hint = "Estándar (balanceado)"

        # 2. Detectar Modelo Base / Arquitectura
        base_model_raw = str(
            metadata.get("modelspec.architecture")
            or metadata.get("ss_base_model_version")
            or metadata.get("ss_sd_model_name")
            or metadata.get("base_model")
            or ""
        )
        path_lower = lora_path.lower()
        sample_keys_str = " ".join(tensor_keys[:40]).lower()
        combined_hint = f"{base_model_raw.lower()} {path_lower} {sample_keys_str}"

        arch = "Estándar"
        arch_family = ""

        if "krea" in path_lower or "krea" in base_model_raw.lower() or "/k-" in path_lower.replace("\\", "/"):
            arch = "Flux / Krea"
            arch_family = "flux"
        elif "flux" in combined_hint or "double_blocks" in sample_keys_str or "single_blocks" in sample_keys_str:
            arch = "Flux.1"
            arch_family = "flux"
        elif "wan" in combined_hint or ("blocks.0.cross_attn" in sample_keys_str and "patch_embedding" in sample_keys_str):
            arch = "Wan 2.1/2.2"
            arch_family = "wan"
        elif "qwen" in combined_hint:
            arch = "Qwen-Image"
            arch_family = "qwen"
        elif "ltx" in combined_hint:
            arch = "LTX-Video"
            arch_family = "ltx"
        elif "hunyuan" in combined_hint:
            arch = "Hunyuan"
            arch_family = "hunyuan"
        elif "sdxl" in combined_hint or "xl" in base_model_raw.lower() or "lora_te2_" in sample_keys_str:
            arch = "SDXL"
            arch_family = "sdxl"
        elif "sd15" in combined_hint or "v1-5" in combined_hint or "lora_unet_down_blocks" in sample_keys_str:
            arch = "SD 1.5"
            arch_family = "sd15"
        elif base_model_raw:
            arch = base_model_raw[:24]
            arch_family = base_model_raw.lower()[:10]

        # 3. Resolución y Steps
        res = str(metadata.get("ss_resolution", "") or "").strip("() ")
        steps = str(metadata.get("ss_max_train_steps") or metadata.get("ss_ steps") or metadata.get("ss_epoch") or "")

        # 4. Trigger Words / Top Tags
        raw_triggers = ""
        tag_freq = metadata.get("ss_tag_frequency", "")
        tags_dict = {}
        if tag_freq:
            try:
                tf = json.loads(tag_freq)
                for _ds, ds_tags in tf.items():
                    if isinstance(ds_tags, dict):
                        for tag, count in ds_tags.items():
                            tags_dict[tag] = tags_dict.get(tag, 0) + int(count)
            except Exception:
                pass

        alt_triggers = metadata.get("modelspec.trigger_words") or metadata.get("trigger_words") or metadata.get("ss_tag_frequency_0") or ""
        if alt_triggers and not tags_dict:
            if isinstance(alt_triggers, list):
                raw_triggers = ", ".join(str(x) for x in alt_triggers)
            else:
                raw_triggers = str(alt_triggers)

        if tags_dict:
            sorted_tags = sorted(tags_dict.items(), key=lambda x: x[1], reverse=True)
            raw_triggers = ", ".join([t for t, _c in sorted_tags[:10]])

        result = {
            "found": True,
            "arch": arch,
            "archFamily": arch_family,
            "rank": rank,
            "alpha": int(alpha) if (alpha is not None and alpha.is_integer()) else alpha,
            "ratio": ratio,
            "strengthHint": strength_hint,
            "resolution": res,
            "steps": steps,
            "baseModel": base_model_raw,
            "triggers": raw_triggers.strip(),
        }

        if cache_key:
            _LORA_META_CACHE[cache_key] = result
        return result

    except Exception as e:
        return {
            "found": False,
            "arch": "Error",
            "archFamily": "",
            "rank": None,
            "alpha": None,
            "ratio": None,
            "strengthHint": "",
            "resolution": "",
            "steps": "",
            "baseModel": "",
            "triggers": "",
            "summary": f"Error reading metadata: {str(e)}",
        }


def read_lora_metadata(lora_path):
    meta = inspect_safetensors_header(lora_path)
    lines = []
    if meta.get("arch"):
        lines.append(f"🧠 Modelo: {meta['arch']}")
    if meta.get("rank"):
        alpha_txt = f" / Alpha {meta['alpha']}" if meta.get("alpha") is not None else ""
        lines.append(f"🏋️ Rank {meta['rank']}{alpha_txt}")
    if meta.get("resolution"):
        lines.append(f"📐 Resolución: {meta['resolution']}")
    if meta.get("triggers"):
        lines.append(f"🏷️ Triggers: {meta['triggers']}")
    return ("\n".join(lines) if lines else "Metadata disponible."), meta.get("triggers", "")


def resolve_lora_path(lora_name):
    if not lora_name or lora_name == "None":
        return None
    path = folder_paths.get_full_path("loras", lora_name)
    if path and os.path.exists(path):
        return path
    if not lora_name.lower().endswith(".safetensors"):
        path = folder_paths.get_full_path("loras", f"{lora_name}.safetensors")
        if path and os.path.exists(path):
            return path
    clean_target = lora_name.replace("\\", "/").lower()
    if clean_target.endswith(".safetensors"):
        clean_target = clean_target[:-12]
    for candidate in folder_paths.get_filename_list("loras"):
        cand_clean = candidate.replace("\\", "/").lower()
        if cand_clean.endswith(".safetensors"):
            cand_clean = cand_clean[:-12]
        if cand_clean == clean_target:
            return folder_paths.get_full_path("loras", candidate)
    return None


@PromptServer.instance.routes.post("/focuspp/lora_info")
@PromptServer.instance.routes.post("/academia/lora_info")
async def get_focuspp_lora_info(request):
    data = await request.json()
    lora_name = data.get("name")
    if not lora_name or lora_name == "None":
        return web.json_response({"info": "No LoRA selected.", "triggers": "", "meta": None})

    lora_path = resolve_lora_path(lora_name)
    meta = await asyncio.to_thread(inspect_safetensors_header, lora_path)
    info, triggers = read_lora_metadata(lora_path)
    return web.json_response({"info": info, "triggers": triggers, "meta": meta})


@PromptServer.instance.routes.post("/focuspp/lora_info_batch")
async def get_focuspp_lora_info_batch(request):
    data = await request.json()
    names = data.get("names", [])
    if not isinstance(names, list):
        return web.json_response({})

    def _read_batch(name_list):
        out = {}
        for name in name_list[:50]:
            if not name or name == "None":
                continue
            path = resolve_lora_path(name)
            out[name] = inspect_safetensors_header(path)
        return out

    batch_res = await asyncio.to_thread(_read_batch, names)
    return web.json_response(batch_res)


@PromptServer.instance.routes.get("/focuspp/lora_list")
@PromptServer.instance.routes.get("/academia/lora_list")
async def get_focuspp_lora_list(request):
    if hasattr(folder_paths, "filename_list_cache") and isinstance(folder_paths.filename_list_cache, dict):
        folder_paths.filename_list_cache.pop("loras", None)
    loras = folder_paths.get_filename_list("loras")
    return web.json_response(loras)


@PromptServer.instance.routes.post("/focuspp/rename_lora")
async def rename_focuspp_lora(request):
    try:
        data = await request.json()
        old_name = str(data.get("oldName", "")).strip()
        new_base_raw = str(data.get("newBaseName", "")).strip()

        if not old_name or old_name == "None":
            return web.json_response({"error": "No hay ningún LoRA seleccionado para renombrar."}, status=400)
        if not new_base_raw:
            return web.json_response({"error": "El nuevo nombre no puede estar vacío."}, status=400)

        # Impedir separadores de ruta o caracteres inválidos en el nombre base
        if "/" in new_base_raw or "\\" in new_base_raw or ".." in new_base_raw:
            return web.json_response({"error": "Escribe solo el nombre del LoRA (sin barras de directorio)."}, status=400)

        old_full_path = resolve_lora_path(old_name)
        if not old_full_path or not os.path.isfile(old_full_path):
            return web.json_response({"error": f"No se encontró el archivo en disco: {old_name}"}, status=404)

        # Validar contención dentro de los directorios configurados de loras
        real_old = os.path.realpath(old_full_path)
        lora_roots = [os.path.realpath(p) for p in folder_paths.get_folder_paths("loras") if os.path.isdir(p)]
        if not any(real_old == r or real_old.startswith(r + os.sep) for r in lora_roots):
            return web.json_response({"error": "Ruta de LoRA fuera de los directorios permitidos."}, status=403)

        parent_dir = os.path.dirname(old_full_path)
        old_filename = os.path.basename(old_full_path)
        old_stem, old_ext = os.path.splitext(old_filename)
        if not old_ext:
            old_ext = ".safetensors"

        # Quitar extensión si el usuario la escribió manualmente
        if new_base_raw.lower().endswith(old_ext.lower()):
            new_stem = new_base_raw[: -len(old_ext)].strip()
        elif new_base_raw.lower().endswith(".safetensors"):
            new_stem = new_base_raw[:-12].strip()
        else:
            new_stem = new_base_raw

        if not new_stem:
            return web.json_response({"error": "Nombre de archivo inválido."}, status=400)

        new_filename = f"{new_stem}{old_ext}"
        new_full_path = os.path.join(parent_dir, new_filename)

        if os.path.normcase(old_full_path) == os.path.normcase(new_full_path) and old_filename == new_filename:
            return web.json_response({
                "renamed": True,
                "oldName": old_name,
                "newName": old_name,
                "backedUp": {},
                "loras": folder_paths.get_filename_list("loras"),
            })

        companion_suffixes = [".preview.png", ".preview.jpg", ".png", ".jpg", ".webp", ".json", ".civitai.info", ".txt"]

        def _rename_with_companions(dir_p, src_s, dst_s, ext_s):
            src_f = os.path.join(dir_p, f"{src_s}{ext_s}")
            dst_f = os.path.join(dir_p, f"{dst_s}{ext_s}")
            os.rename(src_f, dst_f)
            for sfx in companion_suffixes:
                c_old = os.path.join(dir_p, f"{src_s}{sfx}")
                c_new = os.path.join(dir_p, f"{dst_s}{sfx}")
                if os.path.isfile(c_old) and not os.path.exists(c_new):
                    try:
                        os.rename(c_old, c_new)
                    except Exception:
                        pass

        # Recopilar todos los stems existentes en el catálogo de LoRAs para que el nombre -bk sea único globalmente
        all_current_loras = folder_paths.get_filename_list("loras")
        existing_stems_lower = set()
        for l_rel in all_current_loras:
            b_name = os.path.basename(l_rel.replace("\\", "/"))
            s_name, _ = os.path.splitext(b_name)
            existing_stems_lower.add(s_name.lower())

        def _next_available_bk_stem(dir_p, base_s, ext_s):
            candidate_stem = f"{base_s}-bk"
            if not os.path.exists(os.path.join(dir_p, f"{candidate_stem}{ext_s}")) and candidate_stem.lower() not in existing_stems_lower:
                existing_stems_lower.add(candidate_stem.lower())
                return candidate_stem
            counter = 2
            while True:
                candidate_stem = f"{base_s}-bk-{counter}"
                if not os.path.exists(os.path.join(dir_p, f"{candidate_stem}{ext_s}")) and candidate_stem.lower() not in existing_stems_lower:
                    existing_stems_lower.add(candidate_stem.lower())
                    return candidate_stem
                counter += 1

        # Buscar cualquier otro LoRA existente con el mismo nombre (tanto en la misma carpeta como en cualquier subcarpeta de loras)
        conflicts = []
        seen_real_paths = set()

        if os.path.isfile(new_full_path) and os.path.realpath(new_full_path) != real_old:
            real_np = os.path.realpath(new_full_path)
            seen_real_paths.add(real_np)
            conflicts.append((new_full_path, None))

        for l_rel in all_current_loras:
            b_name = os.path.basename(l_rel.replace("\\", "/"))
            s_name, _ = os.path.splitext(b_name)
            if s_name.lower() == new_stem.lower():
                c_full = folder_paths.get_full_path("loras", l_rel)
                if c_full and os.path.isfile(c_full):
                    real_cf = os.path.realpath(c_full)
                    if real_cf != real_old and real_cf not in seen_real_paths:
                        seen_real_paths.add(real_cf)
                        conflicts.append((c_full, l_rel))

        backed_up = {}
        for conflict_full_path, conflict_rel in conflicts:
            c_dir = os.path.dirname(conflict_full_path)
            c_file = os.path.basename(conflict_full_path)
            c_stem, c_ext = os.path.splitext(c_file)
            if not c_ext:
                c_ext = old_ext
            bk_stem = _next_available_bk_stem(c_dir, c_stem, c_ext)
            _rename_with_companions(c_dir, c_stem, bk_stem, c_ext)
            if conflict_rel:
                norm_c = conflict_rel.replace("\\", "/")
                if "/" in norm_c:
                    c_rel_dir = norm_c.rsplit("/", 1)[0]
                    c_sep = "\\" if ("\\" in conflict_rel and "/" not in conflict_rel) else "/"
                    bk_rel = f"{c_rel_dir}{c_sep}{bk_stem}{c_ext}"
                else:
                    bk_rel = f"{bk_stem}{c_ext}"
                backed_up[conflict_rel] = bk_rel

        # Ahora renombrar el LoRA seleccionado al nuevo nombre deseado
        _rename_with_companions(parent_dir, old_stem, new_stem, old_ext)

        # Calcular el nuevo nombre relativo respetando el subdirectorio original en ComfyUI
        normalized_old = old_name.replace("\\", "/")
        if "/" in normalized_old:
            rel_dir = normalized_old.rsplit("/", 1)[0]
            sep = "\\" if ("\\" in old_name and "/" not in old_name) else "/"
            new_rel_name = f"{rel_dir}{sep}{new_filename}"
        else:
            new_rel_name = new_filename

        # Invalidar caché de lista de archivos de ComfyUI para que aparezca de inmediato
        if hasattr(folder_paths, "filename_list_cache") and isinstance(folder_paths.filename_list_cache, dict):
            folder_paths.filename_list_cache.pop("loras", None)

        updated_loras = folder_paths.get_filename_list("loras")
        # Asegurar coincidencia exacta con el formato devuelto por folder_paths
        for cand in updated_loras:
            if cand.replace("\\", "/").lower() == new_rel_name.replace("\\", "/").lower():
                new_rel_name = cand
                break

        return web.json_response({
            "renamed": True,
            "oldName": old_name,
            "newName": new_rel_name,
            "backedUp": backed_up,
            "loras": updated_loras,
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


class FocusPPMultiLoraNode:
    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "model": ("MODEL",),
                "injection_method": (["Standard (Native)", "Model Only (No CLIP)"],),
                "lora_data": ("STRING", {"default": "[]"}),
            },
            "optional": {
                "clip": ("CLIP", {"default": None}),
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "default": "",
                        "tooltip": "Texto opcional (ej: descripcion de accion o entorno) para combinar con los trigger words de los LoRAs activos.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "STRING")
    RETURN_NAMES = ("MODEL", "CLIP", "text")
    OUTPUT_TOOLTIPS = (
        "Modelo resultante con los LoRAs aplicados.",
        "CLIP resultante con los LoRAs aplicados.",
        "Texto resultante con los trigger words configurados en este nodo combinados con el texto de entrada.",
    )
    FUNCTION = "apply_loras"
    CATEGORY = "FocusPP"

    def apply_loras(self, model, injection_method="Standard (Native)", lora_data="[]", clip=None, text="", **kwargs):
        try:
            data = json.loads(lora_data)
        except Exception:
            data = []

        if isinstance(data, dict):
            loras = data.get("loras", [])
            node_triggers = data.get("triggers", "")
        elif isinstance(data, list):
            loras = data
            node_triggers = ""
        else:
            loras = []
            node_triggers = ""

        triggers_str = node_triggers.strip() if isinstance(node_triggers, str) else ""
        input_text = text.strip() if isinstance(text, str) else ""

        if triggers_str and input_text:
            final_text = f"{triggers_str}, {input_text}"
        elif triggers_str:
            final_text = triggers_str
        else:
            final_text = input_text

        if not loras:
            return (model, clip, final_text)

        print("[FocusPP] Starting Multi-LoRA Injection...")

        for lora in loras:
            if not lora.get("enabled", True):
                continue

            lora_name = lora.get("name")
            if not lora_name or lora_name == "None":
                continue

            strength = float(lora.get("strength", 1.0))
            if strength == 0.0:
                print(f"[FocusPP] ⏩ Skipping: {lora_name} (Strength is 0)")
                continue

            lora_path = resolve_lora_path(lora_name)
            if not lora_path:
                print(f"[FocusPP] ❌ Warning: Could not find LoRA file: {lora_name}")
                continue

            print(f"[FocusPP] 💉 Injecting: {lora_name} (Strength: {strength})")

            try:
                lora_tensor = comfy.utils.load_torch_file(lora_path, safe_load=True)
            except Exception as e:
                print(f"[FocusPP] ❌ Error loading LoRA data for {lora_name}: {e}")
                continue

            strength_model = strength
            strength_clip = strength if (injection_method == "Standard (Native)" and clip is not None) else 0.0

            lora_model, lora_clip = comfy.sd.load_lora_for_models(
                model, clip, lora_tensor, strength_model, strength_clip
            )

            if lora_model is not None:
                model = lora_model
            if lora_clip is not None and clip is not None:
                clip = lora_clip

        return (model, clip, final_text)


NODE_CLASS_MAPPINGS = {
    "FocusPP_MultiLora": FocusPPMultiLoraNode,
    "AcademiaSD_MultiLora": FocusPPMultiLoraNode,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "FocusPP_MultiLora": "FocusPP Multi-LoRA 💊",
    "AcademiaSD_MultiLora": "FocusPP Multi-LoRA (Academia Compat) 💊",
}
