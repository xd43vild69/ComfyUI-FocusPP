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

                        // Crear el overlay del modal
                        const overlay = document.createElement("div");
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
                            
                            if (evt.key === "Escape") {
                                // Revertir el texto al estado original y cerrar
                                originalTextarea.value = originalText;
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
                        title.innerText = "Editar Texto: " + targetNode.title;
                        title.style.margin = "0";
                        title.style.fontSize = "24px";

                        const textareaContainer = document.createElement("div");
                        Object.assign(textareaContainer.style, {
                            flex: "1",
                            position: "relative",
                            display: "flex"
                        });
                        
                        // Mover el textarea original al modal
                        textareaContainer.appendChild(originalTextarea);

                        // Aplicar estilos "important" para evitar que LiteGraph lo reubique
                        // Y aplicar tamaño de letra gigante
                        originalTextarea.style.setProperty("position", "relative", "important");
                        originalTextarea.style.setProperty("left", "auto", "important");
                        originalTextarea.style.setProperty("top", "auto", "important");
                        originalTextarea.style.setProperty("transform", "none", "important");
                        originalTextarea.style.setProperty("width", "100%", "important");
                        originalTextarea.style.setProperty("height", "100%", "important");
                        originalTextarea.style.setProperty("flex", "1", "important");
                        originalTextarea.style.setProperty("font-size", "28px", "important");
                        originalTextarea.style.setProperty("line-height", "1.5", "important");
                        originalTextarea.style.setProperty("margin", "0", "important");
                        originalTextarea.style.setProperty("padding", "20px", "important");
                        originalTextarea.style.setProperty("box-sizing", "border-box", "important");
                        originalTextarea.style.setProperty("z-index", "9001", "important");
                        originalTextarea.style.setProperty("background-color", "#111", "important");
                        originalTextarea.style.setProperty("color", "#eee", "important");
                        originalTextarea.style.setProperty("border", "1px solid #555", "important");
                        originalTextarea.style.setProperty("border-radius", "4px", "important");

                        const originalText = originalTextarea.value;

                        // Contenedor de botones
                        const btnContainer = document.createElement("div");
                        Object.assign(btnContainer.style, {
                            display: "flex",
                            justifyContent: "flex-end",
                            gap: "10px"
                        });

                        // Función de cierre y restauración
                        const closeAndRestore = () => {
                            originalTextarea.style.cssText = oldCssText;
                            if (oldParent) {
                                oldParent.appendChild(originalTextarea);
                            }
                            if (textWidget.callback) {
                                textWidget.callback(originalTextarea.value);
                            }
                            app.graph.setDirtyCanvas(true, true);
                            document.body.removeChild(overlay);
                        };

                        const cancelBtn = document.createElement("button");
                        cancelBtn.innerText = "Cerrar (Descartar)";
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
                        saveBtn.innerText = "Guardar y Cerrar";
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

                        modal.appendChild(title);
                        modal.appendChild(textareaContainer);
                        modal.appendChild(btnContainer);
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
