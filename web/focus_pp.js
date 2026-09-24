import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "FocusPositivePrompt",
    async setup() {
        // Asegurar que el autocompletado siempre se dibuje por encima del modal gigante
        const style = document.createElement("style");
        style.innerHTML = `
            .pysssss-autocomplete, 
            #autocomplete-plus-root {
                z-index: 99999 !important;
            }
        `;
        document.head.appendChild(style);

        // Elimina comentarios // y /* ... */ antes de enviar el prompt a procesar
        const stripPromptComments = (text) => {
            if (!text || (typeof text === "string" && !text.includes("//") && !text.includes("/*"))) {
                return text;
            }
            let cleaned = String(text).replace(/\/\*[\s\S]*?\*\//g, "");
            const outLines = [];
            for (const line of cleaned.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed.startsWith("//")) continue;
                const noInlineComment = line.replace(/(^|\s)\/\/.*$/, "");
                outLines.push(noInlineComment);
            }
            return outLines
                .join("\n")
                .replace(/,\s*,+/g, ",")
                .replace(/^\s*,\s*/, "")
                .trim();
        };

        // Función Clear Format (Cmd + Shift + L):
        // Convierte puntos '.' en ',', separa cada frase por ',' en su propia línea terminada en ',',
        // respeta las separaciones de párrafos (líneas en blanco) y preserva comentarios // y /* ... */.
        const clearFormatPromptText = (rawText) => {
            if (!rawText) return "";
            const savedComments = [];
            const protectedText = String(rawText)
                .replace(/\r\n/g, "\n")
                .replace(/\/\*[\s\S]*?\*\//g, (match) => {
                    const id = savedComments.length;
                    savedComments.push(match.trim());
                    return ` __FPP_CMT_${id}__ `;
                })
                .replace(/^[ \t]*\/\/[^\n]*/gm, (match) => {
                    const id = savedComments.length;
                    let cleanCmt = match.trim();
                    if (!cleanCmt.endsWith(",")) cleanCmt += ",";
                    savedComments.push(cleanCmt);
                    return `__FPP_CMT_${id}__,`;
                });

            const paragraphs = protectedText.split(/\n\s*\n+/);

            const formattedParagraphs = paragraphs
                .map((para) => {
                    const joined = para
                        .replace(/\n+/g, " ")
                        .replace(/(?<!\d)\.(?!\d)/g, ",");

                    const phrases = joined
                        .split(",")
                        .map((seg) => seg.replace(/\s+/g, " ").replace(/,+$/, "").trim())
                        .filter((seg) => seg.length > 0);

                    if (phrases.length === 0) return "";
                    return phrases
                        .map((p) => {
                            let restored = p.replace(/__FPP_CMT_(\d+)__/g, (_, idx) => savedComments[Number(idx)] || "");
                            restored = restored.replace(/,+$/, "").trim();
                            return `${restored},`;
                        })
                        .join("\n");
                })
                .filter((p) => p.length > 0);

            return formattedParagraphs.join("\n\n");
        };

        const applyTextareaFormatWithUndo = (textarea, formatted) => {
            if (!textarea || textarea.value === formatted) return;
            const prevScroll = textarea.scrollTop;
            textarea.focus();
            textarea.setSelectionRange(0, textarea.value.length);
            let inserted = false;
            try {
                inserted = document.execCommand("insertText", false, formatted);
            } catch (err) {
                inserted = false;
            }
            if (!inserted || textarea.value !== formatted) {
                textarea.value = formatted;
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
            textarea.scrollTop = prevScroll;
        };

        // Toggle de comentario con Cmd + / (soporta // en líneas completas y /* ... */ en selección parcial)
        const toggleCommentOnTextarea = (textarea) => {
            if (!textarea) return;
            const val = textarea.value || "";
            const selStart = textarea.selectionStart ?? 0;
            const selEnd = textarea.selectionEnd ?? 0;

            const lineStart = val.lastIndexOf("\n", Math.max(0, selStart - 1)) + 1;
            let lineEnd = val.indexOf("\n", selEnd);
            if (lineEnd === -1) lineEnd = val.length;

            const isSingleLinePartialSelection =
                selStart !== selEnd &&
                !val.slice(selStart, selEnd).includes("\n") &&
                (selStart > lineStart || selEnd < lineEnd);

            if (isSingleLinePartialSelection) {
                const selected = val.slice(selStart, selEnd);
                const trimmedSel = selected.trim();
                let replacement;
                let newStart = selStart;
                let newEnd = selEnd;

                // Si la selección ya está envuelta en /* ... */ (dentro o justo alrededor)
                const beforeTwo = val.slice(Math.max(0, selStart - 3), selStart);
                const afterTwo = val.slice(selEnd, Math.min(val.length, selEnd + 3));
                if (trimmedSel.startsWith("/*") && trimmedSel.endsWith("*/")) {
                    replacement = selected.replace(/^\s*\/\*\s?/, "").replace(/\s?\*\/\s*$/, "");
                    newEnd = newStart + replacement.length;
                } else if (beforeTwo.includes("/*") && afterTwo.includes("*/")) {
                    const expandStart = val.lastIndexOf("/*", selStart);
                    const expandEnd = val.indexOf("*/", selEnd) + 2;
                    const inner = val.slice(expandStart + 2, expandEnd - 2).trim();
                    const updated = val.slice(0, expandStart) + inner + val.slice(expandEnd);
                    applyTextareaFormatWithUndo(textarea, updated);
                    textarea.setSelectionRange(expandStart, expandStart + inner.length);
                    return;
                } else {
                    replacement = `/* ${selected} */`;
                    newEnd = newStart + replacement.length;
                }

                const updated = val.slice(0, selStart) + replacement + val.slice(selEnd);
                applyTextareaFormatWithUndo(textarea, updated);
                textarea.setSelectionRange(newStart, newEnd);
                return;
            }

            // Comentario de línea(s) con //
            const blockText = val.slice(lineStart, lineEnd);
            const blockLines = blockText.split("\n");
            const nonEmptyLines = blockLines.filter((l) => l.trim().length > 0);
            const allCommented = nonEmptyLines.length > 0 && nonEmptyLines.every((l) => l.trim().startsWith("//"));

            const toggledLines = blockLines.map((l) => {
                if (!l.trim()) return l;
                if (allCommented) {
                    return l.replace(/^(\s*)\/\/\s?/, "$1");
                } else {
                    return l.replace(/^(\s*)/, "$1// ");
                }
            });

            const newBlock = toggledLines.join("\n");
            const updated = val.slice(0, lineStart) + newBlock + val.slice(lineEnd);
            applyTextareaFormatWithUndo(textarea, updated);
            textarea.setSelectionRange(lineStart, lineStart + newBlock.length);
        };

        // Ctrl + Shift + C (o Cmd + Shift + C): Comentar / descomentar selección específicamente con /* texto aqui */
        const toggleBlockCommentOnTextarea = (textarea) => {
            if (!textarea) return;
            const val = textarea.value || "";
            const selStart = textarea.selectionStart ?? 0;
            const selEnd = textarea.selectionEnd ?? 0;

            // Helper para detectar si un rango [start, end] está dentro de un bloque /* ... */ existente
            const findEnclosingBlockComment = (start, end) => {
                const openIdx = val.lastIndexOf("/*", start);
                if (openIdx === -1) return null;
                // Verificar que no haya un */ entre openIdx y start
                const closeBeforeStart = val.indexOf("*/", openIdx + 2);
                if (closeBeforeStart !== -1 && closeBeforeStart < start) return null;

                const closeIdx = val.indexOf("*/", Math.max(end - 2, openIdx + 2));
                if (closeIdx === -1) return null;
                return { openIdx, closeIdx: closeIdx + 2 };
            };

            if (selStart !== selEnd) {
                const selected = val.slice(selStart, selEnd);
                const trimmedSel = selected.trim();

                // Caso 1: La selección misma incluye /* ... */ al principio y al final
                if (trimmedSel.startsWith("/*") && trimmedSel.endsWith("*/") && trimmedSel.length >= 4) {
                    const replacement = selected.replace(/^(\s*)\/\*\s?/, "$1").replace(/\s?\*\/(\s*)$/, "$1");
                    const updated = val.slice(0, selStart) + replacement + val.slice(selEnd);
                    applyTextareaFormatWithUndo(textarea, updated);
                    textarea.setSelectionRange(selStart, selStart + replacement.length);
                    return;
                }

                // Caso 2: El usuario seleccionó el texto de adentro de un /* ... */ ya existente
                const enclosing = findEnclosingBlockComment(selStart, selEnd);
                if (enclosing) {
                    const inner = val.slice(enclosing.openIdx + 2, enclosing.closeIdx - 2).replace(/^\s/, "").replace(/\s$/, "");
                    const updated = val.slice(0, enclosing.openIdx) + inner + val.slice(enclosing.closeIdx);
                    applyTextareaFormatWithUndo(textarea, updated);
                    textarea.setSelectionRange(enclosing.openIdx, enclosing.openIdx + inner.length);
                    return;
                }

                // Caso 3: No está comentado -> envolver con /* ... */
                const replacement = `/* ${selected} */`;
                const updated = val.slice(0, selStart) + replacement + val.slice(selEnd);
                applyTextareaFormatWithUndo(textarea, updated);
                textarea.setSelectionRange(selStart, selStart + replacement.length);
                return;
            }

            // Si no hay texto seleccionado pero el cursor está dentro de un /* ... */, lo descomenta
            const enclosingCursor = findEnclosingBlockComment(selStart, selEnd);
            if (enclosingCursor) {
                const inner = val.slice(enclosingCursor.openIdx + 2, enclosingCursor.closeIdx - 2).replace(/^\s/, "").replace(/\s$/, "");
                const updated = val.slice(0, enclosingCursor.openIdx) + inner + val.slice(enclosingCursor.closeIdx);
                applyTextareaFormatWithUndo(textarea, updated);
                textarea.setSelectionRange(enclosingCursor.openIdx, enclosingCursor.openIdx + inner.length);
                return;
            }

            // Si no hay selección ni bloque activo, envolver la línea actual en /* ... */
            const lineStart = val.lastIndexOf("\n", selStart - 1) + 1;
            let lineEnd = val.indexOf("\n", selStart);
            if (lineEnd === -1) lineEnd = val.length;
            const lineContent = val.slice(lineStart, lineEnd);
            if (lineContent.trim().length > 0) {
                const replacement = `/* ${lineContent} */`;
                const updated = val.slice(0, lineStart) + replacement + val.slice(lineEnd);
                applyTextareaFormatWithUndo(textarea, updated);
                textarea.setSelectionRange(lineStart, lineStart + replacement.length);
            } else {
                const replacement = "/*  */";
                const updated = val.slice(0, selStart) + replacement + val.slice(selEnd);
                applyTextareaFormatWithUndo(textarea, updated);
                textarea.setSelectionRange(selStart + 3, selStart + 3);
            }
        };

        window.addEventListener("keydown", (e) => {
            // Ctrl + Shift + C (o Cmd + Shift + C): Comentar / descomentar selección con /* texto aqui */
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key.toLowerCase() === "c" || e.code === "KeyC")) {
                if (e.target && e.target.tagName === "TEXTAREA") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const acPopup = document.getElementById("autocomplete-plus-root");
                    if (acPopup) acPopup.style.display = "none";
                    toggleBlockCommentOnTextarea(e.target);
                    return;
                }
            }

            // Cmd + / (o Ctrl + /): Silenciar / activar frase o línea con comentario en cualquier textarea de prompt
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === "/" || e.code === "Slash")) {
                if (e.target && e.target.tagName === "TEXTAREA") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    toggleCommentOnTextarea(e.target);
                    return;
                }
            }

            // Cmd + Shift + L (o Ctrl + Shift + L): Clear Format en cualquier textarea activo o en el nodo pp13
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key.toLowerCase() === "l" || e.code === "KeyL")) {
                let targetTextarea = null;
                if (e.target && e.target.tagName === "TEXTAREA") {
                    targetTextarea = e.target;
                } else if (app.graph && app.graph._nodes) {
                    const ppNode = app.graph._nodes.find(n => n.title && n.title.toLowerCase().trim().startsWith("pp"));
                    const textWidget = ppNode?.widgets?.find(w => w.type === "customtext" || w.name === "text" || w.type === "string");
                    targetTextarea = textWidget?.inputEl || textWidget?.element || null;
                }
                if (targetTextarea) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const acPopup = document.getElementById("autocomplete-plus-root");
                    if (acPopup) acPopup.style.display = "none";
                    const formatted = clearFormatPromptText(targetTextarea.value);
                    applyTextareaFormatWithUndo(targetTextarea, formatted);
                    return;
                }
            }

            // Cmd + Shift + S (o Ctrl + Shift + S) para guardar imagen del nodo "output13"
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key.toLowerCase() === "s" || e.code === "KeyS")) {
                if (!app.graph) return;
                
                // Ignorar si el usuario está escribiendo texto en un input
                if (e.target.localName === "input" || e.target.localName === "textarea") return;

                // BLOQUEAR SIEMPRE el comportamiento por defecto (silencia el atajo nativo)
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                // Buscar de forma más segura (ignora mayúsculas y espacios extra)
                const targetNode = app.graph._nodes.find(n => n.title && n.title.toLowerCase().trim() === "output13");
                
                if (targetNode && targetNode.imgs && targetNode.imgs.length > 0) {
                    // Descargar las imágenes disponibles forzando conversión a Blob (evita que el navegador solo las abra en otra pestaña)
                    for (let i = 0; i < targetNode.imgs.length; i++) {
                        const img = targetNode.imgs[i];
                        
                        fetch(img.src)
                            .then(response => response.blob())
                            .then(blob => {
                                const blobUrl = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = blobUrl;
                                const filename = targetNode.imgs.length > 1 ? `output13_image_${i}.png` : `output13_image.png`;
                                a.download = filename;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(blobUrl);
                            })
                            .catch(err => console.error("Error al descargar imagen:", err));
                    }
                } else {
                    console.warn("ComfyUI-FocusPP: No se encontró el nodo output13 o no tiene imágenes.");
                }
                return;
            }

            // Rastrear estado físico de Cmd/Ctrl para macOS (donde Cocoa convierte Cmd+Esc en cancelOperation: con metaKey=false)
            if (e.key === "Meta" || e.key === "Control" || e.metaKey || e.ctrlKey) {
                window._fppMetaHeld = true;
                window._fppLastMetaTime = Date.now();
            }

            // Cmd + Esc, Ctrl + Esc, o Esc en cualquier parte de la ventana: cerrar inmediatamente el modal activo
            if (e.key === "Escape" || e.code === "Escape" || e.keyCode === 27) {
                const isCmdOrCtrlEsc =
                    e.metaKey ||
                    e.ctrlKey ||
                    window._fppMetaHeld ||
                    (window._fppLastMetaTime && Date.now() - window._fppLastMetaTime < 1500);

                const acPopup = document.getElementById("autocomplete-plus-root");
                const isAcVisible = acPopup && acPopup.style.display !== "none" && acPopup.offsetParent !== null;

                // Si es Cmd+Esc cerramos el modal siempre; si es Esc solo y el autocomplete NO está visible, también cerramos el modal
                if (isCmdOrCtrlEsc || !isAcVisible) {
                    if (acPopup) acPopup.style.display = "none";

                    const acEditorOverlay = document.getElementById("fpp-ac-editor-overlay");
                    if (acEditorOverlay) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        acEditorOverlay.remove();
                        return;
                    }

                    const existingOverlay = document.getElementById("focus-pp-overlay");
                    if (existingOverlay) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        if (typeof existingOverlay._closeAndRestore === "function") {
                            existingOverlay._closeAndRestore();
                        } else {
                            existingOverlay.remove();
                        }
                        return;
                    }
                }
            }

            // Cmd + Enter (o Ctrl + Enter) en cualquier parte del modal: guardar y cerrar el modal
            if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.code === "Enter")) {
                const existingOverlay = document.getElementById("focus-pp-overlay");
                if (existingOverlay && typeof existingOverlay._closeAndRestore === "function") {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const acPopup = document.getElementById("autocomplete-plus-root");
                    if (acPopup) acPopup.style.display = "none";
                    existingOverlay._closeAndRestore();
                    return;
                }
            }

            // Escuchar si se presiona la tecla F2
            if (e.key === "F2") {
                const existingOverlay = document.getElementById("focus-pp-overlay");
                if (existingOverlay) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (typeof existingOverlay._closeAndRestore === "function") {
                        existingOverlay._closeAndRestore();
                    } else {
                        existingOverlay.remove();
                    }
                    return;
                }

                if (!app.graph || !app.canvas) return;

                const nodes = app.graph._nodes;

                // Buscar el nodo que empiece con "pp"
                let targetNode = null;
                for (let node of nodes) {
                    if (node.title && node.title.toLowerCase().startsWith("pp")) {
                        targetNode = node;
                        break; // Se detiene en el primero que encuentre
                    }
                }

                if (targetNode) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    // Centrar la cámara en el nodo encontrado
                    app.canvas.centerOnNode(targetNode);

                    // Buscar la caja de texto dentro del nodo (normalmente el widget "text" o "customtext")
                    const textWidget = targetNode.widgets?.find(w => w.type === "customtext" || w.name === "text" || w.type === "string");

                    if (textWidget && textWidget.inputEl) {
                        const originalTextarea = textWidget.inputEl;
                        const oldParent = originalTextarea.parentNode;
                        const oldCssText = originalTextarea.style.cssText;

                        // Crear el overlay del modal
                        const overlay = document.createElement("div");
                        overlay.id = "focus-pp-overlay";
                        Object.assign(overlay.style, {
                            position: "fixed",
                            top: "0",
                            left: "0",
                            width: "100%",
                            height: "100%",
                            backgroundColor: "rgba(0, 0, 0, 0.8)",
                            zIndex: "9000", // Menor que 10000 para que el autocompletado aparezca encima
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center"
                        });
                        // No cerrar al dar click fuera
                        overlay.addEventListener("click", (evt) => {
                            evt.stopPropagation();
                        });

                        // Crear el contenedor principal del modal (95% de pantalla)
                        const modal = document.createElement("div");
                        Object.assign(modal.style, {
                            backgroundColor: "#222",
                            border: "1px solid #444",
                            borderRadius: "8px",
                            padding: "20px",
                            width: "95vw",
                            height: "95vh",
                            display: "flex",
                            flexDirection: "column",
                            gap: "15px",
                            boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
                            color: "#fff",
                            fontFamily: "sans-serif"
                        });
                        // Estado de ancla/foco para selección bidireccional fluida con Cmd + Shift + ArrowUp / ArrowDown
                        let selAnchor = null;
                        let selFocus = null;

                        const syncSelectionEndpoints = () => {
                            const s = originalTextarea.selectionStart ?? 0;
                            const e = originalTextarea.selectionEnd ?? 0;
                            const dir = originalTextarea.selectionDirection;
                            if (s === e) {
                                selAnchor = s;
                                selFocus = e;
                            } else if (
                                selAnchor !== null &&
                                selFocus !== null &&
                                Math.min(selAnchor, selFocus) === s &&
                                Math.max(selAnchor, selFocus) === e
                            ) {
                                // Conservar selAnchor y selFocus actuales
                            } else if (dir === "backward") {
                                selAnchor = e;
                                selFocus = s;
                            } else {
                                selAnchor = s;
                                selFocus = e;
                            }
                        };

                        const getSelectionStepBoundaries = (text) => {
                            const bounds = new Set([0, text.length]);
                            // 1. Límites naturales de párrafo / línea (\n)
                            for (let i = 0; i < text.length; i++) {
                                if (text[i] === "\n") {
                                    bounds.add(i);
                                    if (i + 1 <= text.length) bounds.add(i + 1);
                                }
                            }
                            // 2. Si hay párrafos largos sin saltos de línea (> 85 chars), añadir sub-bloques por frases/comas (~75 chars)
                            const sortedLines = Array.from(bounds).sort((a, b) => a - b);
                            for (let k = 0; k < sortedLines.length - 1; k++) {
                                const segStart = sortedLines[k];
                                const segEnd = sortedLines[k + 1];
                                if (segEnd - segStart > 85) {
                                    let lastMark = segStart;
                                    for (let pos = segStart + 45; pos < segEnd - 25; pos++) {
                                        if ((text[pos] === "," || text[pos] === ".") && pos - lastMark >= 55) {
                                            const mark = pos + 1 < segEnd && text[pos + 1] === " " ? pos + 2 : pos + 1;
                                            bounds.add(mark);
                                            lastMark = mark;
                                        } else if (pos - lastMark >= 85 && text[pos] === " ") {
                                            bounds.add(pos + 1);
                                            lastMark = pos + 1;
                                        }
                                    }
                                }
                            }
                            return Array.from(bounds).sort((a, b) => a - b);
                        };

                        const onModalMousedown = () => {
                            selAnchor = null;
                            selFocus = null;
                        };
                        originalTextarea.addEventListener("mousedown", onModalMousedown);

                        modal.addEventListener("click", (evt) => evt.stopPropagation());
                        // IMPORTANTE: stopPropagation en fase BUBBLE (sin capture: true) en el modal
                        // para que el evento keydown SIEMPRE baje primero hasta originalTextarea y Autocomplete-Plus
                        // pueda recibir ArrowUp, ArrowDown, Enter, Tab y Escape.
                        modal.addEventListener("keydown", (evt) => {
                            evt.stopPropagation();
                        });

                        const onModalKeyDown = (evt) => {
                            if (evt.key === "F2") {
                                evt.preventDefault();
                                evt.stopPropagation();
                                closeAndRestore();
                                return;
                            }

                            if (evt.metaKey && evt.key === "Escape") {
                                evt.preventDefault();
                                evt.stopPropagation();
                                // Revertir el texto al estado original y cerrar
                                originalTextarea.value = originalText;
                                closeAndRestore();
                                return;
                            }

                            if (evt.metaKey && evt.key === "Enter") {
                                evt.preventDefault();
                                evt.stopPropagation();
                                closeAndRestore();
                                return;
                            }

                            // Ctrl + Shift + C (o Cmd + Shift + C) dentro del modal Text-Editor: Comentar / Descomentar selección con /* ... */
                            if ((evt.ctrlKey || evt.metaKey) && evt.shiftKey && !evt.altKey && (evt.key.toLowerCase() === "c" || evt.code === "KeyC")) {
                                evt.preventDefault();
                                evt.stopImmediatePropagation();
                                const acPopup = document.getElementById("autocomplete-plus-root");
                                if (acPopup) acPopup.style.display = "none";
                                toggleBlockCommentOnTextarea(originalTextarea);
                                updateMirror();
                                return;
                            }

                            // Cmd + / dentro del modal Text-Editor: Silenciar / Des-silenciar línea o selección
                            if ((evt.metaKey || evt.ctrlKey) && !evt.shiftKey && !evt.altKey && (evt.key === "/" || evt.code === "Slash")) {
                                evt.preventDefault();
                                evt.stopImmediatePropagation();
                                const acPopup = document.getElementById("autocomplete-plus-root");
                                if (acPopup) acPopup.style.display = "none";
                                toggleCommentOnTextarea(originalTextarea);
                                updateMirror();
                                return;
                            }

                            // Cmd + Shift + L dentro del modal Text-Editor: Clear Format
                            if ((evt.metaKey || evt.ctrlKey) && evt.shiftKey && (evt.key.toLowerCase() === "l" || evt.code === "KeyL")) {
                                evt.preventDefault();
                                evt.stopImmediatePropagation();
                                const acPopup = document.getElementById("autocomplete-plus-root");
                                if (acPopup) acPopup.style.display = "none";
                                const formatted = clearFormatPromptText(originalTextarea.value);
                                applyTextareaFormatWithUndo(originalTextarea, formatted);
                                updateMirror();
                                selAnchor = null;
                                selFocus = null;
                                return;
                            }

                            // Alt + ArrowUp / ArrowDown: Mover la línea/frase actual hacia arriba o abajo
                            if (evt.altKey && !evt.metaKey && !evt.ctrlKey && !evt.shiftKey && (evt.key === "ArrowUp" || evt.key === "ArrowDown")) {
                                evt.preventDefault();
                                evt.stopImmediatePropagation();
                                const val = originalTextarea.value;
                                const lines = val.split("\n");
                                const cursorPos = originalTextarea.selectionStart ?? 0;
                                let charCount = 0;
                                let lineIdx = 0;
                                for (let i = 0; i < lines.length; i++) {
                                    if (cursorPos <= charCount + lines[i].length) {
                                        lineIdx = i;
                                        break;
                                    }
                                    charCount += lines[i].length + 1;
                                }
                                const targetIdx = evt.key === "ArrowUp" ? lineIdx - 1 : lineIdx + 1;
                                if (targetIdx >= 0 && targetIdx < lines.length) {
                                    const tmp = lines[lineIdx];
                                    lines[lineIdx] = lines[targetIdx];
                                    lines[targetIdx] = tmp;
                                    const newText = lines.join("\n");
                                    let newLineStart = 0;
                                    for (let i = 0; i < targetIdx; i++) {
                                        newLineStart += lines[i].length + 1;
                                    }
                                    applyTextareaFormatWithUndo(originalTextarea, newText);
                                    originalTextarea.setSelectionRange(newLineStart, newLineStart + lines[targetIdx].length);
                                    updateMirror();
                                }
                                return;
                            }

                            // Prioridad máxima a la selección de texto con flechas (SOLO cuando hay modificadores Shift/Meta/Alt):
                            // ocultar popups flotantes que bloqueen la selección con Shift/Cmd + ArrowUp/Down
                            if (
                                (evt.shiftKey || evt.metaKey || evt.altKey || evt.ctrlKey) &&
                                (evt.key === "ArrowUp" || evt.key === "ArrowDown" || evt.key === "ArrowLeft" || evt.key === "ArrowRight")
                            ) {
                                const acPopup = document.getElementById("autocomplete-plus-root");
                                if (acPopup) acPopup.style.display = "none";
                                document.querySelectorAll(".pysssss-autocomplete").forEach(el => {
                                    el.style.display = "none";
                                });
                            }

                            // Cmd + Shift + ArrowUp / ArrowDown: Desplazamiento fluido de la selección hacia atrás y hacia adelante
                            if ((evt.metaKey || evt.ctrlKey) && evt.shiftKey && (evt.key === "ArrowUp" || evt.key === "ArrowDown")) {
                                evt.preventDefault();
                                evt.stopImmediatePropagation();

                                syncSelectionEndpoints();
                                const text = originalTextarea.value || "";
                                const boundaries = getSelectionStepBoundaries(text);

                                let newFocus = selFocus;
                                if (evt.key === "ArrowUp") {
                                    // Buscar el límite anterior (< selFocus)
                                    let prevBound = 0;
                                    for (let i = boundaries.length - 1; i >= 0; i--) {
                                        if (boundaries[i] < selFocus) {
                                            prevBound = boundaries[i];
                                            break;
                                        }
                                    }
                                    newFocus = prevBound;
                                } else {
                                    // ArrowDown: Buscar el límite siguiente (> selFocus)
                                    let nextBound = text.length;
                                    for (let i = 0; i < boundaries.length; i++) {
                                        if (boundaries[i] > selFocus) {
                                            nextBound = boundaries[i];
                                            break;
                                        }
                                    }
                                    newFocus = nextBound;
                                }

                                selFocus = newFocus;
                                const newStart = Math.min(selAnchor, selFocus);
                                const newEnd = Math.max(selAnchor, selFocus);
                                const newDir = selFocus < selAnchor ? "backward" : "forward";
                                originalTextarea.setSelectionRange(newStart, newEnd, newDir);
                                return;
                            } else if (evt.key === "ArrowUp" || evt.key === "ArrowDown" || evt.key === "ArrowLeft" || evt.key === "ArrowRight") {
                                // Si usa flechas normales o con Shift/Alt, actualizar endpoints en el siguiente tick
                                // sin interceptar el evento para que Autocomplete-Plus pueda navegar con ArrowUp/ArrowDown
                                setTimeout(syncSelectionEndpoints, 0);
                            } else if (evt.key === "Enter" || evt.key === "Tab") {
                                // Si Autocomplete-Plus inserta un tag con Enter/Tab, refrescar el espejo en el siguiente tick
                                setTimeout(updateMirror, 0);
                            }
                        };
                        originalTextarea.addEventListener("keydown", onModalKeyDown, { capture: true });

                        const title = document.createElement("h3");
                        title.innerText = "Text-Editor: " + targetNode.title;
                        title.style.margin = "0";
                        title.style.fontSize = "24px";

                        const textareaContainer = document.createElement("div");
                        Object.assign(textareaContainer.style, {
                            flex: "1",
                            position: "relative",
                            display: "block"
                        });

                        // Crear el div espejo (Patrón Espejo)
                        const mirrorDiv = document.createElement("div");
                        Object.assign(mirrorDiv.style, {
                            position: "absolute",
                            top: "0",
                            left: "0",
                            width: "100%",
                            height: "100%",
                            fontSize: "28px",
                            lineHeight: "1.5",
                            margin: "0",
                            padding: "20px",
                            boxSizing: "border-box",
                            zIndex: "9000",
                            backgroundColor: "#111",
                            color: "#eee",
                            border: "1px solid #555",
                            borderRadius: "4px",
                            whiteSpace: "pre-wrap",
                            wordWrap: "break-word",
                            pointerEvents: "none",
                            overflowY: "hidden",
                            overflowX: "hidden",
                            fontFamily: "monospace"
                        });
                        textareaContainer.appendChild(mirrorDiv);

                        // Identificar si existe un wrapper de autocomplete para no romperlo
                        let elementToMove = originalTextarea;
                        const originalParent = originalTextarea.parentNode;
                        const originalNextSibling = originalTextarea.nextSibling;
                        let movedWrapper = null;
                        
                        if (originalParent && originalParent.tagName && originalParent.tagName.toLowerCase() === 'div' && 
                           (originalParent.className.includes("autocomplete") || originalParent.className.includes("pysssss"))) {
                            elementToMove = originalParent;
                            movedWrapper = {
                                parent: elementToMove.parentNode,
                                sibling: elementToMove.nextSibling,
                                cssText: elementToMove.style.cssText
                            };
                        }

                        // Mover al modal (ya sea solo el textarea o el wrapper entero)
                        textareaContainer.appendChild(elementToMove);

                        // Si movimos el wrapper, tenemos que asegurar que ocupe todo el espacio
                        if (movedWrapper) {
                            elementToMove.style.setProperty("position", "absolute", "important");
                            elementToMove.style.setProperty("left", "0", "important");
                            elementToMove.style.setProperty("top", "0", "important");
                            elementToMove.style.setProperty("width", "100%", "important");
                            elementToMove.style.setProperty("height", "100%", "important");
                            elementToMove.style.setProperty("z-index", "9001", "important");
                        }

                        originalTextarea.style.setProperty("position", "absolute", "important");
                        originalTextarea.style.setProperty("left", "0", "important");
                        originalTextarea.style.setProperty("top", "0", "important");
                        originalTextarea.style.setProperty("width", "100%", "important");
                        originalTextarea.style.setProperty("height", "100%", "important");
                        originalTextarea.style.setProperty("font-size", "28px", "important");
                        originalTextarea.style.setProperty("line-height", "1.5", "important");
                        originalTextarea.style.setProperty("margin", "0", "important");
                        originalTextarea.style.setProperty("padding", "20px", "important");
                        originalTextarea.style.setProperty("box-sizing", "border-box", "important");
                        originalTextarea.style.setProperty("z-index", "9001", "important");
                        originalTextarea.style.setProperty("background-color", "transparent", "important");
                        originalTextarea.style.setProperty("color", "transparent", "important");
                        originalTextarea.style.setProperty("caret-color", "white", "important");
                        originalTextarea.style.setProperty("border", "1px solid transparent", "important");
                        originalTextarea.style.setProperty("border-radius", "4px", "important");
                        originalTextarea.style.setProperty("outline", "none", "important");
                        originalTextarea.style.setProperty("resize", "none", "important");
                        originalTextarea.style.setProperty("font-family", "monospace", "important");
                        originalTextarea.style.setProperty("overflow-y", "auto", "important");
                        originalTextarea.style.setProperty("overflow-x", "hidden", "important");
                        
                        const originalText = originalTextarea.value;

                        // Contador de estadísticas
                        const statsDiv = document.createElement("div");
                        Object.assign(statsDiv.style, {
                            color: "#aaa",
                            fontSize: "16px",
                            fontFamily: "monospace"
                        });

                        // Función de sincronización del Patrón Espejo
                        const updateMirror = () => {
                            const text = originalTextarea.value;
                            const activeText = stripPromptComments(text);

                            // Actualizar estadísticas reales (excluyendo lo silenciado)
                            const wordCount = activeText.trim() === "" ? 0 : activeText.trim().split(/\s+/).length;
                            const phraseCount = activeText.split(',').map(p => p.trim()).filter(p => p.length > 0).length;
                            const mutedBlocks = (text.match(/\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$/gm) || []).length;
                            statsDiv.innerHTML = mutedBlocks > 0
                                ? `words: ${wordCount} , phrases: ${phraseCount} <span style="color:#f59e0b; margin-left:8px;">(🔇 ${mutedBlocks} silenciada${mutedBlocks > 1 ? 's' : ''} — Cmd+/)</span>`
                                : `words: ${wordCount} , phrases: ${phraseCount} <span style="color:#64748b; margin-left:8px;">(Cmd+/ para silenciar)</span>`;

                            // Tokenizar primero bloques comentados /* ... */ y líneas // ... para pintarlos en gris tachado
                            const commentTokens = [];
                            const tokenized = text
                                .replace(/\/\*[\s\S]*?\*\//g, (m) => {
                                    const id = commentTokens.length;
                                    commentTokens.push(m);
                                    return `\u0000CMT_${id}\u0000`;
                                })
                                .replace(/^([ \t]*\/\/[^\n]*)/gm, (m) => {
                                    const id = commentTokens.length;
                                    commentTokens.push(m);
                                    return `\u0000CMT_${id}\u0000`;
                                });

                            const escapeHtml = (s) =>
                                s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

                            const parts = tokenized.split(",");
                            let html = "";
                            let activeColorIdx = 0;

                            for (let i = 0; i < parts.length; i++) {
                                const seg = parts[i];
                                const commaSuffix = i < parts.length - 1 ? "," : "";
                                const fullSeg = seg + commaSuffix;

                                // Si el segmento entero es un comentario de línea
                                if (/^\s*\u0000CMT_\d+\u0000\s*,?\s*$/.test(fullSeg)) {
                                    const restored = fullSeg.replace(/\u0000CMT_(\d+)\u0000/g, (_, idx) => {
                                        const cmt = escapeHtml(commentTokens[Number(idx)] || "");
                                        return `<span style="color: #565f70; text-decoration: line-through; opacity: 0.68;">${cmt}</span>`;
                                    });
                                    html += `<span style="color: #565f70;">${restored}</span>`;
                                } else {
                                    const color = activeColorIdx % 2 === 0 ? "#78859C" : "#789C8F";
                                    activeColorIdx++;
                                    const escaped = escapeHtml(fullSeg).replace(/\u0000CMT_(\d+)\u0000/g, (_, idx) => {
                                        const cmt = escapeHtml(commentTokens[Number(idx)] || "");
                                        return `<span style="color: #565f70; text-decoration: line-through; opacity: 0.68;">${cmt}</span>`;
                                    });
                                    html += `<span style="color: ${color}">${escaped}</span>`;
                                }
                            }

                            if (text.endsWith('\n')) {
                                html += '<br/>';
                            }
                            mirrorDiv.innerHTML = html;
                        };

                        const syncScroll = () => {
                            mirrorDiv.scrollTop = originalTextarea.scrollTop;
                        };

                        originalTextarea.addEventListener('input', updateMirror);
                        originalTextarea.addEventListener('scroll', syncScroll);
                        updateMirror();

                        // Contenedor principal inferior
                        const bottomContainer = document.createElement("div");
                        Object.assign(bottomContainer.style, {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: "10px"
                        });

                        // Contenedor de botones
                        const btnContainer = document.createElement("div");
                        Object.assign(btnContainer.style, {
                            display: "flex",
                            gap: "10px"
                        });

                        // Función de cierre y restauración
                        const closeAndRestore = () => {
                            originalTextarea.removeEventListener('input', updateMirror);
                            originalTextarea.removeEventListener('scroll', syncScroll);
                            originalTextarea.removeEventListener('keydown', onModalKeyDown, { capture: true });
                            originalTextarea.removeEventListener('mousedown', onModalMousedown);
                            
                            // Restaurar estilos y posición en el DOM
                            originalTextarea.style.cssText = oldCssText;
                            
                            if (movedWrapper) {
                                elementToMove.style.cssText = movedWrapper.cssText;
                                if (movedWrapper.parent) {
                                    movedWrapper.parent.insertBefore(elementToMove, movedWrapper.sibling);
                                }
                            } else {
                                if (originalParent) {
                                    originalParent.insertBefore(elementToMove, originalNextSibling);
                                }
                            }
                            
                            if (textWidget.callback) {
                                textWidget.callback(originalTextarea.value);
                            }
                            app.graph.setDirtyCanvas(true, true);
                            if (overlay.parentNode) {
                                overlay.parentNode.removeChild(overlay);
                            }
                        };
                        overlay._closeAndRestore = closeAndRestore;
                        overlay._cancelAndRestore = () => {
                            originalTextarea.value = originalText;
                            closeAndRestore();
                        };

                        const clearFormatBtn = document.createElement("button");
                        clearFormatBtn.innerText = "✨ Clear Format (Cmd+Shift+L)";
                        Object.assign(clearFormatBtn.style, {
                            padding: "15px 22px",
                            cursor: "pointer",
                            backgroundColor: "#7c3aed",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            fontSize: "16px",
                            fontWeight: "bold"
                        });
                        clearFormatBtn.onclick = () => {
                            const formatted = clearFormatPromptText(originalTextarea.value);
                            applyTextareaFormatWithUndo(originalTextarea, formatted);
                            updateMirror();
                            originalTextarea.focus();
                        };

                        const editAcBtn = document.createElement("button");
                        editAcBtn.innerText = "🏷️ Editar Autocomplete";
                        Object.assign(editAcBtn.style, {
                            padding: "15px 22px",
                            cursor: "pointer",
                            backgroundColor: "#2563eb",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            fontSize: "16px",
                            fontWeight: "bold"
                        });
                        editAcBtn.onclick = () => {
                            openAutocompleteEditorModal();
                        };

                        const cancelBtn = document.createElement("button");
                        cancelBtn.innerText = "Close";
                        Object.assign(cancelBtn.style, {
                            padding: "15px 30px",
                            cursor: "pointer",
                            backgroundColor: "#555",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            fontSize: "18px",
                            fontWeight: "bold"
                        });
                        cancelBtn.onclick = () => {
                            // Revertir el texto al estado original
                            originalTextarea.value = originalText;
                            closeAndRestore();
                        };

                        const saveBtn = document.createElement("button");
                        saveBtn.innerText = "Save";
                        Object.assign(saveBtn.style, {
                            padding: "15px 30px",
                            cursor: "pointer",
                            backgroundColor: "#4CAF50",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            fontSize: "18px",
                            fontWeight: "bold"
                        });
                        saveBtn.onclick = () => {
                            closeAndRestore();
                        };

                        btnContainer.appendChild(clearFormatBtn);
                        btnContainer.appendChild(editAcBtn);
                        btnContainer.appendChild(cancelBtn);
                        btnContainer.appendChild(saveBtn);

                        bottomContainer.appendChild(statsDiv);
                        bottomContainer.appendChild(btnContainer);

                        modal.appendChild(title);
                        modal.appendChild(textareaContainer);
                        modal.appendChild(bottomContainer);
                        overlay.appendChild(modal);

                        document.body.appendChild(overlay);

                        originalTextarea.focus();
                        originalTextarea.setSelectionRange(0, 0);
                        originalTextarea.scrollTop = 0;
                        mirrorDiv.scrollTop = 0;
                    }
                }
            }
        }, { capture: true }); // Usamos capture: true para que nuestro atajo se ejecute ANTES que los de ComfyUI

        // Fallback en keyup para macOS: en Mac, Cocoa convierte Cmd+Esc en cancelOperation: (metaKey=false)
        // o emite el keyup de Escape justo al soltar Cmd.
        window.addEventListener("keyup", (e) => {
            if (e.key === "Meta" || e.key === "Control") {
                window._fppMetaHeld = false;
                window._fppLastMetaTime = Date.now();
                return;
            }
            if (e.key === "Escape" || e.code === "Escape" || e.keyCode === 27) {
                const isCmdOrCtrlEsc =
                    e.metaKey ||
                    e.ctrlKey ||
                    window._fppMetaHeld ||
                    (window._fppLastMetaTime && Date.now() - window._fppLastMetaTime < 1500);

                const acPopup = document.getElementById("autocomplete-plus-root");
                const isAcVisible = acPopup && acPopup.style.display !== "none" && acPopup.offsetParent !== null;

                if (isCmdOrCtrlEsc || !isAcVisible) {
                    if (acPopup) acPopup.style.display = "none";

                    const acEditorOverlay = document.getElementById("fpp-ac-editor-overlay");
                    if (acEditorOverlay) {
                        e.preventDefault();
                        e.stopPropagation();
                        acEditorOverlay.remove();
                        return;
                    }

                    const existingOverlay = document.getElementById("focus-pp-overlay");
                    if (existingOverlay) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (typeof existingOverlay._closeAndRestore === "function") {
                            existingOverlay._closeAndRestore();
                        } else {
                            existingOverlay.remove();
                        }
                    }
                }
            }
        }, { capture: true });

        // --- RECARGA EN CALIENTE DE COMFYUI-AUTOCOMPLETE-PLUS ---
        const reloadAutocompletePlusInMemory = async () => {
            try {
                const acDataMod = await import("/extensions/ComfyUI-Autocomplete-Plus/js/data.js");
                if (acDataMod && acDataMod.autoCompleteData) {
                    const danbooruData = acDataMod.autoCompleteData["danbooru"];
                    if (danbooruData) {
                        danbooruData.sortedTags = [];
                        if (danbooruData.tagMap) danbooruData.tagMap.clear();
                        if (danbooruData.aliasMap) danbooruData.aliasMap.clear();
                        danbooruData.isInitializing = false;
                        danbooruData.initialized = false;
                    }
                    if (typeof acDataMod.loadDataAsync === "function") {
                        await acDataMod.loadDataAsync();
                        return true;
                    }
                }
            } catch (err) {
                console.warn("[FocusPP] No se pudo recargar Autocomplete-Plus en caliente:", err);
            }
            return false;
        };

        // --- MODAL EDITOR DE SNIPPETS / TAGS DE AUTOCOMPLETE-PLUS ---
        const openAutocompleteEditorModal = async () => {
            if (document.getElementById("fpp-ac-editor-overlay")) return;

            const overlay = document.createElement("div");
            overlay.id = "fpp-ac-editor-overlay";
            Object.assign(overlay.style, {
                position: "fixed",
                top: "0",
                left: "0",
                width: "100vw",
                height: "100vh",
                backgroundColor: "rgba(0, 0, 0, 0.82)",
                backdropFilter: "blur(4px)",
                zIndex: "100020",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                fontFamily: "system-ui, -apple-system, sans-serif"
            });

            const modal = document.createElement("div");
            Object.assign(modal.style, {
                backgroundColor: "#181a20",
                border: "1px solid #383e4c",
                borderRadius: "10px",
                width: "88vw",
                maxWidth: "1180px",
                height: "84vh",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 18px 50px rgba(0,0,0,0.75)",
                color: "#e2e8f0",
                overflow: "hidden"
            });
            overlay.appendChild(modal);

            // Cabecera
            const header = document.createElement("div");
            Object.assign(header.style, {
                padding: "14px 20px",
                backgroundColor: "#111318",
                borderBottom: "1px solid #2b303c",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px"
            });

            const titleBox = document.createElement("div");
            titleBox.innerHTML = `
                <div style="font-size: 16px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px;">
                    <span>🏷️ Editor de Snippets & Tags — Autocomplete Plus</span>
                </div>
                <div id="fpp-ac-meta-subtitle" style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">
                    Cargando danbooru_tags.csv...
                </div>
            `;

            const controlsRight = document.createElement("div");
            Object.assign(controlsRight.style, {
                display: "flex",
                alignItems: "center",
                gap: "8px"
            });

            const btnModeTable = document.createElement("button");
            btnModeTable.innerText = "📋 Vista Tabla";
            const btnModeRaw = document.createElement("button");
            btnModeRaw.innerText = "📝 Vista CSV Crudo";

            const styleTabBtn = (btn, active) => {
                Object.assign(btn.style, {
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: active ? "1px solid #3b82f6" : "1px solid #333",
                    backgroundColor: active ? "rgba(59, 130, 246, 0.22)" : "#222630",
                    color: active ? "#93c5fd" : "#94a3b8",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: "pointer"
                });
            };

            controlsRight.appendChild(btnModeTable);
            controlsRight.appendChild(btnModeRaw);
            header.appendChild(titleBox);
            header.appendChild(controlsRight);
            modal.appendChild(header);

            // Barra de herramientas (Búsqueda + Botón Añadir)
            const toolbar = document.createElement("div");
            Object.assign(toolbar.style, {
                padding: "10px 20px",
                backgroundColor: "#1d2028",
                borderBottom: "1px solid #2b303c",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px"
            });

            const searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.placeholder = "🔍 Filtrar por alias (ej. canon28mm, phstudio1) o texto del prompt...";
            Object.assign(searchInput.style, {
                flex: "1",
                padding: "7px 12px",
                borderRadius: "6px",
                border: "1px solid #3b4252",
                backgroundColor: "#111318",
                color: "#fff",
                fontSize: "12.5px",
                outline: "none"
            });

            const btnAddRow = document.createElement("button");
            btnAddRow.innerText = "➕ Nuevo Atajo / Snippet";
            Object.assign(btnAddRow.style, {
                padding: "7px 14px",
                borderRadius: "6px",
                border: "1px solid #2563eb",
                backgroundColor: "#2563eb",
                color: "#fff",
                fontSize: "12.5px",
                fontWeight: "600",
                cursor: "pointer",
                whiteSpace: "nowrap"
            });

            toolbar.appendChild(searchInput);
            toolbar.appendChild(btnAddRow);
            modal.appendChild(toolbar);

            // Cuerpo principal
            const body = document.createElement("div");
            Object.assign(body.style, {
                flex: "1",
                overflowY: "auto",
                padding: "14px 20px",
                display: "flex",
                flexDirection: "column",
                gap: "8px"
            });

            const rawTextarea = document.createElement("textarea");
            Object.assign(rawTextarea.style, {
                width: "100%",
                height: "100%",
                flex: "1",
                backgroundColor: "#0f1115",
                color: "#e2e8f0",
                border: "1px solid #383e4c",
                borderRadius: "6px",
                padding: "12px",
                fontFamily: "monospace",
                fontSize: "13px",
                lineHeight: "1.55",
                resize: "none",
                outline: "none",
                boxSizing: "border-box",
                display: "none"
            });

            const tableContainer = document.createElement("div");
            Object.assign(tableContainer.style, {
                display: "flex",
                flexDirection: "column",
                gap: "6px"
            });

            body.appendChild(tableContainer);
            body.appendChild(rawTextarea);
            modal.appendChild(body);

            // Pie del modal
            const footer = document.createElement("div");
            Object.assign(footer.style, {
                padding: "12px 20px",
                backgroundColor: "#111318",
                borderTop: "1px solid #2b303c",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
            });

            const statusLabel = document.createElement("div");
            statusLabel.style.cssText = "font-size: 12px; color: #94a3b8;";
            statusLabel.innerText = "💡 Tip: Usa Cmd + Enter para guardar y recargar en caliente.";

            const footerBtns = document.createElement("div");
            footerBtns.style.cssText = "display: flex; gap: 10px;";

            const btnCancel = document.createElement("button");
            btnCancel.innerText = "Cerrar (Esc)";
            Object.assign(btnCancel.style, {
                padding: "8px 18px",
                borderRadius: "6px",
                border: "1px solid #4b5563",
                backgroundColor: "#262934",
                color: "#e2e8f0",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer"
            });

            const btnSave = document.createElement("button");
            btnSave.innerText = "💾 Guardar y Recargar (Cmd + Enter)";
            Object.assign(btnSave.style, {
                padding: "8px 20px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: "#10b981",
                color: "#06281e",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer"
            });

            footerBtns.appendChild(btnCancel);
            footerBtns.appendChild(btnSave);
            footer.appendChild(statusLabel);
            footer.appendChild(footerBtns);
            modal.appendChild(footer);

            let currentMode = "items"; // "items" | "raw"
            let itemsState = [];

            const renderTable = () => {
                tableContainer.innerHTML = "";
                const filter = (searchInput.value || "").trim().toLowerCase();

                // Encabezado de columnas
                const colHeader = document.createElement("div");
                colHeader.style.cssText = "display: grid; grid-template-columns: 190px 1fr 105px 84px; gap: 8px; padding: 4px 8px; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;";
                colHeader.innerHTML = `
                    <div>Alias (Atajo)</div>
                    <div>Prompt / Tag Expandido</div>
                    <div>Prioridad</div>
                    <div style="text-align: right;">Acciones</div>
                `;
                tableContainer.appendChild(colHeader);

                itemsState.forEach((item, idx) => {
                    const matchAlias = (item.alias || "").toLowerCase().includes(filter);
                    const matchTag = (item.tag || "").toLowerCase().includes(filter);
                    if (filter && !matchAlias && !matchTag) return;

                    const row = document.createElement("div");
                    row.style.cssText = "display: grid; grid-template-columns: 190px 1fr 105px 84px; gap: 8px; align-items: center; background: #222631; border: 1px solid #323846; border-radius: 6px; padding: 6px 8px;";

                    const inpAlias = document.createElement("input");
                    inpAlias.type = "text";
                    inpAlias.className = "fpp-ac-alias-input";
                    inpAlias.placeholder = "ej. canon28mm";
                    inpAlias.value = item.alias || "";
                    inpAlias.style.cssText = "width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 4px; border: 1px solid #3f475a; background: #14171f; color: #7dd3fc; font-weight: 600; font-family: monospace; font-size: 12.5px; outline: none;";
                    inpAlias.addEventListener("input", (e) => {
                        itemsState[idx].alias = e.target.value;
                    });

                    const inpTag = document.createElement("input");
                    inpTag.type = "text";
                    inpTag.placeholder = "Prompt completo que se insertará al elegir el alias...";
                    inpTag.value = item.tag || "";
                    inpTag.style.cssText = "width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 4px; border: 1px solid #3f475a; background: #14171f; color: #f1f5f9; font-size: 12.5px; outline: none;";
                    inpTag.addEventListener("input", (e) => {
                        itemsState[idx].tag = e.target.value;
                    });

                    const inpCount = document.createElement("input");
                    inpCount.type = "text";
                    inpCount.value = item.count || "9999999";
                    inpCount.title = "Frecuencia/Prioridad en el ranking de Autocomplete Plus";
                    inpCount.style.cssText = "width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 4px; border: 1px solid #3f475a; background: #14171f; color: #a7f3d0; font-family: monospace; font-size: 12px; text-align: right; outline: none;";
                    inpCount.addEventListener("input", (e) => {
                        itemsState[idx].count = e.target.value;
                    });

                    const actions = document.createElement("div");
                    actions.style.cssText = "display: flex; justify-content: flex-end; gap: 4px;";

                    const mkBtn = (label, title, color, onClick) => {
                        const b = document.createElement("button");
                        b.innerText = label;
                        b.title = title;
                        b.style.cssText = `background: #181b22; border: 1px solid #383e4c; color: ${color}; border-radius: 4px; padding: 4px 6px; cursor: pointer; font-size: 11px;`;
                        b.onclick = onClick;
                        return b;
                    };

                    actions.appendChild(mkBtn("⬆️", "Subir", idx > 0 ? "#cbd5e1" : "#475569", () => {
                        if (idx === 0) return;
                        const tmp = itemsState[idx - 1];
                        itemsState[idx - 1] = itemsState[idx];
                        itemsState[idx] = tmp;
                        renderTable();
                    }));

                    actions.appendChild(mkBtn("⬇️", "Bajar", idx < itemsState.length - 1 ? "#cbd5e1" : "#475569", () => {
                        if (idx >= itemsState.length - 1) return;
                        const tmp = itemsState[idx + 1];
                        itemsState[idx + 1] = itemsState[idx];
                        itemsState[idx] = tmp;
                        renderTable();
                    }));

                    actions.appendChild(mkBtn("🗑️", "Eliminar fila", "#f87171", () => {
                        itemsState.splice(idx, 1);
                        renderTable();
                    }));

                    row.appendChild(inpAlias);
                    row.appendChild(inpTag);
                    row.appendChild(inpCount);
                    row.appendChild(actions);
                    tableContainer.appendChild(row);
                });
            };

            const setMode = (mode) => {
                currentMode = mode;
                styleTabBtn(btnModeTable, mode === "items");
                styleTabBtn(btnModeRaw, mode === "raw");
                if (mode === "items") {
                    tableContainer.style.display = "flex";
                    rawTextarea.style.display = "none";
                    toolbar.style.display = "flex";
                    renderTable();
                } else {
                    tableContainer.style.display = "none";
                    rawTextarea.style.display = "block";
                    toolbar.style.display = "none";
                    // Sincronizar tabla -> texto CSV
                    const lines = itemsState
                        .filter(it => (it.tag || "").trim())
                        .map(it => {
                            const t = String(it.tag || "").trim();
                            const quotedTag = (t.includes(",") || t.includes('"')) ? `"${t.replace(/"/g, '""')}"` : t;
                            const cat = String(it.category || "0").trim() || "0";
                            const cnt = String(it.count || "9999999").trim() || "9999999";
                            const al = String(it.alias || "").trim();
                            return `${quotedTag},${cat},${cnt},${al}`;
                        });
                    rawTextarea.value = lines.join("\n");
                }
            };

            btnModeTable.onclick = () => setMode("items");
            btnModeRaw.onclick = () => setMode("raw");
            searchInput.addEventListener("input", () => renderTable());

            btnAddRow.onclick = () => {
                searchInput.value = "";
                itemsState.unshift({
                    tag: "",
                    category: "0",
                    count: "9999999",
                    alias: ""
                });
                renderTable();
                const firstAlias = tableContainer.querySelector(".fpp-ac-alias-input");
                if (firstAlias) {
                    firstAlias.focus();
                }
            };

            const closeModal = () => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            };

            btnCancel.onclick = closeModal;

            const saveChanges = async () => {
                btnSave.disabled = true;
                btnSave.innerText = "⏳ Guardando...";
                statusLabel.style.color = "#60a5fa";
                statusLabel.innerText = "Guardando en danbooru_tags.csv y recargando índice...";

                try {
                    const payload = currentMode === "raw"
                        ? { mode: "raw", rawCustomCsv: rawTextarea.value }
                        : { mode: "items", items: itemsState };

                    const res = await fetch("/focuspp/autocomplete_data", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();
                    if (!res.ok || data.error) {
                        throw new Error(data.error || "Error al guardar");
                    }

                    itemsState = data.items || [];
                    rawTextarea.value = data.rawCustomCsv || "";
                    if (currentMode === "items") renderTable();

                    const reloaded = await reloadAutocompletePlusInMemory();
                    statusLabel.style.color = "#34d399";
                    statusLabel.innerText = reloaded
                        ? `✅ ¡Guardado (${data.customCount} snippets) y recargado en caliente en Autocomplete Plus!`
                        : `✅ Guardado en disco (${data.customCount} snippets).`;
                    btnSave.innerText = "✅ ¡Guardado!";
                    setTimeout(() => {
                        btnSave.disabled = false;
                        btnSave.innerText = "💾 Guardar y Recargar (Cmd + Enter)";
                    }, 1400);
                } catch (err) {
                    statusLabel.style.color = "#f87171";
                    statusLabel.innerText = `❌ Error: ${err.message}`;
                    btnSave.disabled = false;
                    btnSave.innerText = "💾 Guardar y Recargar (Cmd + Enter)";
                }
            };

            btnSave.onclick = saveChanges;

            overlay.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                    e.preventDefault();
                    closeModal();
                } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    saveChanges();
                }
            });

            document.body.appendChild(overlay);
            setMode("items");

            // Cargar datos desde el backend
            try {
                const res = await fetch("/focuspp/autocomplete_data");
                const data = await res.json();
                if (res.ok && !data.error) {
                    itemsState = data.items || [];
                    rawTextarea.value = data.rawCustomCsv || "";
                    const sub = document.getElementById("fpp-ac-meta-subtitle");
                    if (sub) {
                        sub.innerText = `Archivo: ${data.filePath} · ${itemsState.length} snippets personalizados (+ ${data.baseCount} tags base de Danbooru protegidos)`;
                    }
                    renderTable();
                } else {
                    const sub = document.getElementById("fpp-ac-meta-subtitle");
                    if (sub) sub.innerText = `⚠️ ${data.error || "No se pudo cargar el archivo CSV"}`;
                }
            } catch (e) {
                const sub = document.getElementById("fpp-ac-meta-subtitle");
                if (sub) sub.innerText = `⚠️ Error de red cargando datos: ${e.message}`;
            }
        };

        // --- ICONO EN EL NODO PP13 (Y CUALQUIER NODO QUE INICIE CON "PP") ---
        const attachIconToPPNode = (node) => {
            if (!node || node.__fppAcHooked) return;
            node.__fppAcHooked = true;

            const isPPNode = () => node.title && node.title.toLowerCase().trim().startsWith("pp");

            // 1. Dibujar un botón [🏷️] en la esquina superior derecha del nodo sobre el canvas
            const origDrawForeground = node.onDrawForeground;
            node.onDrawForeground = function(ctx) {
                if (origDrawForeground) origDrawForeground.apply(this, arguments);
                if (!isPPNode() || this.flags?.collapsed) return;

                ctx.save();
                const btnW = 26;
                const btnH = 18;
                const btnX = this.size[0] - btnW - 6;
                const btnY = -LiteGraph.NODE_TITLE_HEIGHT + (LiteGraph.NODE_TITLE_HEIGHT - btnH) / 2;

                ctx.fillStyle = "rgba(37, 99, 235, 0.85)";
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(btnX, btnY, btnW, btnH, 4);
                } else {
                    ctx.rect(btnX, btnY, btnW, btnH);
                }
                ctx.fill();

                ctx.font = "11px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#ffffff";
                ctx.fillText("🏷️", btnX + btnW / 2, btnY + btnH / 2 + 0.5);
                ctx.restore();
            };

            const origMouseDown = node.onMouseDown;
            node.onMouseDown = function(e, localPos, canvas) {
                if (isPPNode() && !this.flags?.collapsed && localPos) {
                    const btnW = 26;
                    const btnH = 18;
                    const btnX = this.size[0] - btnW - 6;
                    const btnY = -LiteGraph.NODE_TITLE_HEIGHT + (LiteGraph.NODE_TITLE_HEIGHT - btnH) / 2;
                    if (
                        localPos[0] >= btnX - 2 &&
                        localPos[0] <= btnX + btnW + 2 &&
                        localPos[1] >= btnY - 2 &&
                        localPos[1] <= btnY + btnH + 2
                    ) {
                        openAutocompleteEditorModal();
                        return true;
                    }
                }
                if (origMouseDown) return origMouseDown.apply(this, arguments);
            };

            // 2. Asegurar que el widget de texto de pp13 filtre comentarios al serializar para ejecución
            const ensureDomBadge = () => {
                if (!isPPNode()) return;
                const textWidget = node.widgets?.find(w => w.type === "customtext" || w.name === "text" || w.type === "string");
                if (textWidget && !textWidget._fppCommentSerializeHooked) {
                    textWidget._fppCommentSerializeHooked = true;
                    const origSerialize = textWidget.serializeValue;
                    textWidget.serializeValue = async function (...args) {
                        const rawVal = origSerialize
                            ? await origSerialize.apply(this, args)
                            : this.value;
                        return typeof rawVal === "string" ? stripPromptComments(rawVal) : rawVal;
                    };
                }
            };

            setTimeout(ensureDomBadge, 150);
            setTimeout(ensureDomBadge, 800);
        };

        // Escanear nodos actuales y futuros para adjuntar el icono a pp13
        setInterval(() => {
            if (!app.graph || !app.graph._nodes) return;
            for (const n of app.graph._nodes) {
                attachIconToPPNode(n);
                if (n.title && n.title.toLowerCase().trim().startsWith("pp")) {
                    const textWidget = n.widgets?.find(w => w.type === "customtext" || w.name === "text" || w.type === "string");
                    const parentEl = (textWidget?.inputEl || textWidget?.element)?.parentElement;
                    if (parentEl && !parentEl.querySelector(".fpp-pp13-ac-btn") && parentEl.id !== "focus-pp-overlay") {
                        n.__fppAcHooked = false;
                        attachIconToPPNode(n);
                    }
                }
            }
        }, 1000);

        // --- BOTÓN PARA COLAPSAR / EXPANDIR LA BARRA DE ACCIONES SUPERIOR (DEJANDO SOLO RUN / QUEUE) ---
        const COLLAPSE_STORAGE_KEY = "fpp_actionbar_collapsed";
        let isActionbarCollapsed = localStorage.getItem(COLLAPSE_STORAGE_KEY) !== "false"; // Por defecto colapsada como pidió el usuario

        const collapseStyle = document.createElement("style");
        collapseStyle.id = "fpp-actionbar-collapse-style";
        collapseStyle.innerHTML = `
            body.fpp-actionbar-collapsed .pixaroma-align-group,
            body.fpp-actionbar-collapsed .pixwb-group-btn,
            body.fpp-actionbar-collapsed .pixhb-group-btn,
            body.fpp-actionbar-collapsed .fpp-collapsible-toolbar-item {
                display: none !important;
            }
            .fpp-actionbar-toggle-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 28px;
                border-radius: 6px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                background: rgba(30, 33, 42, 0.85);
                color: #94a3b8;
                cursor: pointer;
                font-size: 11px;
                padding: 0;
                margin-right: 2px;
                transition: all 0.15s ease;
                user-select: none;
            }
            .fpp-actionbar-toggle-btn:hover {
                background: rgba(59, 130, 246, 0.25);
                border-color: rgba(96, 165, 250, 0.5);
                color: #ffffff;
            }
        `;
        document.head.appendChild(collapseStyle);

        const syncActionbarCollapseState = () => {
            document.body.classList.toggle("fpp-actionbar-collapsed", isActionbarCollapsed);
            const settingsGroupEl = app.menu?.settingsGroup?.element;
            if (!settingsGroupEl) return;

            // Marcar settingsGroup ("Show Image Feed") y todos los botones de custom nodes a su izquierda
            settingsGroupEl.classList.add("fpp-collapsible-toolbar-item");
            let prev = settingsGroupEl.previousElementSibling;
            while (prev) {
                if (!prev.classList.contains("fpp-actionbar-toggle-group")) {
                    prev.classList.add("fpp-collapsible-toolbar-item");
                }
                prev = prev.previousElementSibling;
            }

            // Crear o actualizar el botón de colapsar/expandir justo después de settingsGroup (al lado de ⋮⋮ Run)
            let toggleBtn = document.getElementById("fpp-actionbar-toggle-btn");
            if (!toggleBtn) {
                toggleBtn = document.createElement("button");
                toggleBtn.id = "fpp-actionbar-toggle-btn";
                toggleBtn.type = "button";
                toggleBtn.className = "fpp-actionbar-toggle-btn fpp-actionbar-toggle-group";
                toggleBtn.addEventListener("click", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    isActionbarCollapsed = !isActionbarCollapsed;
                    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(isActionbarCollapsed));
                    syncActionbarCollapseState();
                });
                settingsGroupEl.after(toggleBtn);
            }

            toggleBtn.innerHTML = isActionbarCollapsed ? "◀" : "▶";
            toggleBtn.title = isActionbarCollapsed
                ? "Mostrar barra de herramientas (Manager, Pixaroma, Feed...)"
                : "Colapsar barra de herramientas (dejar solo Run)";
        };

        // Ejecutar y observar inserciones tardías de custom nodes (ej. Pixaroma / Manager / rgthree)
        syncActionbarCollapseState();
        const actionbarInterval = setInterval(() => {
            syncActionbarCollapseState();
        }, 600);
        setTimeout(() => clearInterval(actionbarInterval), 12000);
        setInterval(syncActionbarCollapseState, 3000);
    }
});
