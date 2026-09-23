import { app } from "../../scripts/app.js";

function showFocusToast(message, type = "success") {
    const existing = document.getElementById("focuspp-pi13-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "focuspp-pi13-toast";

    const colors = {
        success: { bg: "rgba(20, 35, 25, 0.95)", border: "#2ea043", text: "#e6ffed" },
        warning: { bg: "rgba(45, 35, 15, 0.95)", border: "#d29922", text: "#fff8c5" },
        error:   { bg: "rgba(45, 20, 20, 0.95)", border: "#f85149", text: "#ffebe9" },
        info:    { bg: "rgba(25, 30, 45, 0.95)", border: "#388bfd", text: "#cae8ff" }
    };
    const palette = colors[type] || colors.info;

    Object.assign(toast.style, {
        position: "fixed",
        bottom: "28px",
        right: "28px",
        backgroundColor: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.border}`,
        borderLeft: `5px solid ${palette.border}`,
        borderRadius: "8px",
        padding: "12px 18px",
        fontSize: "14px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: "500",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
        zIndex: "100001",
        pointerEvents: "none",
        opacity: "0",
        transform: "translateY(10px)",
        transition: "opacity 0.2s ease, transform 0.2s ease"
    });

    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 220);
    }, 3000);
}

function getDefaultFilename(index = null) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return index !== null ? `pi13_${stamp}_${index + 1}.png` : `pi13_${stamp}.png`;
}

async function triggerBrowserSave(imgElement, suggestedName) {
    // 1. Si el explorador soporta showSaveFilePicker nativo, abrir directamente la ventana del explorador
    if (typeof window.showSaveFilePicker === "function") {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName,
                types: [
                    {
                        description: "Imagen PNG",
                        accept: { "image/png": [".png"] }
                    }
                ]
            });

            const response = await fetch(imgElement.src);
            if (!response.ok) {
                throw new Error(`Error al obtener imagen (${response.status})`);
            }
            const blob = await response.blob();

            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            return { saved: true, filename: fileHandle.name };
        } catch (pickerErr) {
            if (pickerErr && (pickerErr.name === "AbortError" || pickerErr.message?.includes("aborted"))) {
                return { saved: false, cancelled: true };
            }
            // Si está deshabilitado en el navegador (ej. Brave/Safari/Firefox), pasar directo al guardado nativo del navegador
        }
    }

    // 2. Disparar directamente el guardado nativo del explorador sin ningún modal intermedio
    const response = await fetch(imgElement.src);
    if (!response.ok) {
        throw new Error(`Error al leer la imagen (${response.status})`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);

    return { saved: true, filename: suggestedName };
}

app.registerExtension({
    name: "ComfyUI-FocusPP.SavePI13",
    setup() {
        window.addEventListener("keydown", async (e) => {
            // Ignorar si el usuario está escribiendo texto en un input/textarea
            if (e.target.localName === "input" || e.target.localName === "textarea") return;

            // Tecla F1 (sin modificadores)
            if ((e.key === "F1" || e.code === "F1") && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                if (!app.graph) return;

                // Buscar el nodo con título "pi13" (ignorando mayúsculas/espacios extra)
                const targetNode = app.graph._nodes.find(
                    (n) => n.title && n.title.toLowerCase().trim() === "pi13"
                );

                if (!targetNode) {
                    showFocusToast("⚠️ No se encontró ningún nodo con el título 'pi13'", "warning");
                    console.warn("ComfyUI-FocusPP (F1): No se encontró el nodo 'pi13'.");
                    return;
                }

                if (!targetNode.imgs || targetNode.imgs.length === 0) {
                    showFocusToast("⚠️ El nodo 'pi13' no tiene ninguna imagen para guardar", "warning");
                    console.warn("ComfyUI-FocusPP (F1): El nodo 'pi13' no tiene imágenes generadas.");
                    return;
                }

                // Determinar cuál imagen guardar (si hay una seleccionada en el preview usa imageIndex, si no la primera/actual)
                const activeIdx =
                    typeof targetNode.imageIndex === "number" &&
                    targetNode.imageIndex >= 0 &&
                    targetNode.imageIndex < targetNode.imgs.length
                        ? targetNode.imageIndex
                        : 0;

                const targetImg = targetNode.imgs[activeIdx];
                const suggestedName = getDefaultFilename(targetNode.imgs.length > 1 ? activeIdx : null);

                try {
                    const result = await triggerBrowserSave(targetImg, suggestedName);
                    if (result && result.saved) {
                        showFocusToast(`✅ Imagen guardada: ${result.filename}`, "success");
                    }
                } catch (err) {
                    if (err && (err.name === "AbortError" || err.message?.includes("aborted"))) {
                        return;
                    }
                    console.error("ComfyUI-FocusPP (F1) Error al guardar imagen de pi13:", err);
                    showFocusToast("❌ Error al guardar la imagen de 'pi13'", "error");
                }
            }
        }, { capture: true });
    }
});
