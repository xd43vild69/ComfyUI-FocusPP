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

        window.addEventListener("keydown", (e) => {
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

            // Escuchar si se presiona la tecla F2
            if (e.key === "F2") {
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

                    // Centrar la cámara en el nodo encontrado
                    app.canvas.centerOnNode(targetNode);

                    // Buscar la caja de texto dentro del nodo (normalmente el widget "text" o "customtext")
                    const textWidget = targetNode.widgets?.find(w => w.type === "customtext" || w.name === "text" || w.type === "string");

                    if (textWidget && textWidget.inputEl) {
                        const originalTextarea = textWidget.inputEl;
                        const oldParent = originalTextarea.parentNode;
                        const oldCssText = originalTextarea.style.cssText;

                        if (document.getElementById("focus-pp-overlay")) return; // Prevent multiple modals

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
                        modal.addEventListener("click", (evt) => evt.stopPropagation());
                        modal.addEventListener("keydown", (evt) => {
                            evt.stopPropagation();

                            if (evt.key === "F2") {
                                evt.preventDefault();
                                closeAndRestore();
                                return;
                            }

                            if (evt.metaKey && evt.key === "Escape") {
                                // Revertir el texto al estado original y cerrar
                                originalTextarea.value = originalText;
                                closeAndRestore();
                                return;
                            }

                            if (evt.metaKey && evt.key === "Enter") {
                                closeAndRestore();
                                return;
                            }
                            // Navegación de tags con Shift + Alt + Flechas (DESHABILITADO TEMPORALMENTE)
                            /*
                            if (evt.shiftKey && evt.altKey && (evt.key === "ArrowRight" || evt.key === "ArrowLeft")) {
                                evt.preventDefault(); // Evitar comportamiento normal de las flechas
                                
                                const text = originalTextarea.value;
                                const cursorPos = originalTextarea.selectionStart;
                                
                                let parts = text.split(/([,\n]+)/);
                                let currentLength = 0;
                                let partIndex = -1;
                                
                                // Encontrar en qué bloque está el cursor (los bloques de texto están en índices pares 0, 2, 4...)
                                for (let i = 0; i < parts.length; i += 2) {
                                    let partStart = currentLength;
                                    let partEnd = currentLength + parts[i].length;
                                    let delimLength = (i + 1 < parts.length) ? parts[i+1].length : 0;
                                    
                                    // Comprobar si el cursor está dentro del tag o su delimitador
                                    if (cursorPos >= partStart && cursorPos <= partEnd + delimLength) {
                                        partIndex = i;
                                        break;
                                    }
                                    currentLength += parts[i].length + delimLength;
                                }
                                
                                if (partIndex !== -1) {
                                    let nextIndex = evt.key === "ArrowRight" ? partIndex + 2 : partIndex - 2;
                                    
                                    // Respetar límites
                                    if (nextIndex >= 0 && nextIndex < parts.length) {
                                        // Intercambiar los bloques de texto (dejando los delimitadores de comas/saltos de línea intactos en su sitio)
                                        let temp = parts[partIndex];
                                        parts[partIndex] = parts[nextIndex];
                                        parts[nextIndex] = temp;
                                        
                                        // Reconstruir el texto
                                        originalTextarea.value = parts.join('');
                                        
                                        // Calcular nueva posición para mantener el texto seleccionado
                                        let newStart = 0;
                                        for(let i=0; i < nextIndex; i++) {
                                            newStart += parts[i].length;
                                        }
                                        let newEnd = newStart + parts[nextIndex].length;
                                        
                                        originalTextarea.focus();
                                        originalTextarea.setSelectionRange(newStart, newEnd);
                                        
                                        // Disparar evento de input para que ComfyUI y autocomplete registren el cambio
                                        originalTextarea.dispatchEvent(new Event("input", { bubbles: true }));
                                    }
                                }
                            }
                            */
                        });

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
                            
                            // Actualizar estadísticas
                            const wordCount = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
                            const phraseCount = text.split(',').map(p => p.trim()).filter(p => p.length > 0).length;
                            statsDiv.innerHTML = `words: ${wordCount} , phrases: ${phraseCount}`;

                            const parts = text.split(',');

                            let html = '';
                            for (let i = 0; i < parts.length; i++) {
                                const color = i % 2 === 0 ? '#78859C' : '#789C8F';
                                let escapedText = parts[i]
                                    .replace(/&/g, '&amp;')
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;');

                                html += `<span style="color: ${color}">${escapedText}</span>`;
                                if (i < parts.length - 1) {
                                    html += `<span style="color: #666">,</span>`;
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
                            document.body.removeChild(overlay);
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
                        const len = originalTextarea.value.length;
                        originalTextarea.setSelectionRange(len, len);
                    }
                }
            }
        }, { capture: true }); // Usamos capture: true para que nuestro atajo se ejecute ANTES que los de ComfyUI

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

            // 2. Añadir también un botón flotante HTML en la esquina superior derecha de la caja de texto de pp13
            const ensureDomBadge = () => {
                if (!isPPNode()) return;
                const textWidget = node.widgets?.find(w => w.type === "customtext" || w.name === "text" || w.type === "string");
                const inputEl = textWidget?.inputEl || textWidget?.element;
                const parentEl = inputEl?.parentElement;
                if (!parentEl || parentEl.querySelector(".fpp-pp13-ac-btn")) return;

                const badgeBtn = document.createElement("button");
                badgeBtn.type = "button";
                badgeBtn.className = "fpp-pp13-ac-btn";
                badgeBtn.innerHTML = "🏷️";
                badgeBtn.title = "Editar Snippets de Autocomplete Plus";
                Object.assign(badgeBtn.style, {
                    position: "absolute",
                    top: "6px",
                    right: "12px",
                    zIndex: "30",
                    width: "26px",
                    height: "24px",
                    borderRadius: "5px",
                    border: "1px solid rgba(96, 165, 250, 0.45)",
                    backgroundColor: "rgba(30, 41, 59, 0.85)",
                    color: "#fff",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    opacity: "0.78",
                    transition: "opacity 0.15s, transform 0.15s, background-color 0.15s",
                    padding: "0"
                });
                badgeBtn.onmouseenter = () => {
                    badgeBtn.style.opacity = "1";
                    badgeBtn.style.backgroundColor = "rgba(37, 99, 235, 0.95)";
                };
                badgeBtn.onmouseleave = () => {
                    badgeBtn.style.opacity = "0.78";
                    badgeBtn.style.backgroundColor = "rgba(30, 41, 59, 0.85)";
                };
                badgeBtn.addEventListener("mousedown", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    openAutocompleteEditorModal();
                });

                if (getComputedStyle(parentEl).position === "static") {
                    parentEl.style.position = "relative";
                }
                parentEl.appendChild(badgeBtn);
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
    }
});
