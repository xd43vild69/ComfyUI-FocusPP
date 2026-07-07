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
        });
    }
});
