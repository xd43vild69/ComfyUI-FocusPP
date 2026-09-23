import os
import json
import struct
import comfy.sd
import comfy.utils
import folder_paths
from server import PromptServer
from aiohttp import web
import asyncio


def read_lora_metadata(lora_path):
    if not lora_path or not os.path.exists(lora_path):
        return "File not found.", ""
    if not lora_path.endswith(".safetensors"):
        return "Metadata reading is only supported for .safetensors files.", ""

    try:
        with open(lora_path, "rb") as f:
            header_size = struct.unpack("<Q", f.read(8))[0]
            header_json = f.read(header_size).decode("utf-8")
            header = json.loads(header_json)

            metadata = header.get("__metadata__", {})
            if not metadata:
                return "No training metadata found in this LoRA.", ""

            output = []
            raw_triggers = ""

            base_model = metadata.get("ss_sd_model_name", metadata.get("ss_base_model_version", ""))
            if base_model:
                output.append(f"🧠 Base Model: {base_model}")

            res = metadata.get("ss_resolution", "")
            if res:
                output.append(f"📐 Resolution: {res}")

            tag_freq = metadata.get("ss_tag_frequency", "")
            tags_dict = {}
            if tag_freq:
                try:
                    tf = json.loads(tag_freq)
                    for ds, ds_tags in tf.items():
                        for tag, count in ds_tags.items():
                            tags_dict[tag] = tags_dict.get(tag, 0) + count
                except Exception:
                    pass

            alt_triggers = metadata.get("modelspec.trigger_words", metadata.get("ss_tag_frequency_0", ""))
            if alt_triggers and not tags_dict:
                output.append(f"\n🏷️ Triggers:\n{alt_triggers}")
                raw_triggers = str(alt_triggers)

            if tags_dict:
                sorted_tags = sorted(tags_dict.items(), key=lambda x: x[1], reverse=True)
                top_tags = [f"{t}" for t, c in sorted_tags[:15]]
                output.append("\n🏷️ Top Training Tags:\n" + ", ".join(top_tags))
                raw_triggers = ", ".join([t for t, c in sorted_tags[:8]])

            if not output:
                return "Metadata exists, but no tags or model info were found.", ""

            return "\n".join(output), raw_triggers

    except Exception as e:
        return f"Error reading metadata: {str(e)}", ""


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
async def get_focuspp_lora_info(request):
    data = await request.json()
    lora_name = data.get("name")
    if not lora_name or lora_name == "None":
        return web.json_response({"info": "No LoRA selected.", "triggers": ""})

    lora_path = resolve_lora_path(lora_name)
    info, triggers = await asyncio.to_thread(read_lora_metadata, lora_path)
    return web.json_response({"info": info, "triggers": triggers})


@PromptServer.instance.routes.get("/focuspp/lora_list")
async def get_focuspp_lora_list(request):
    loras = folder_paths.get_filename_list("loras")
    return web.json_response(loras)


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
