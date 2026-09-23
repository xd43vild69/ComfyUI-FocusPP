import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI-FocusPP.FocusPL13",
    setup() {
        window.addEventListener("keydown", (e) => {
            // Ignorar si el usuario está escribiendo en un campo de texto
            if (e.target.localName === "input" || e.target.localName === "textarea") return;

            // F3 key
            if (e.key === 'F3') {
                e.preventDefault();
                e.stopPropagation();
                
                if (!app.graph) return;

                // Buscar el nodo que tenga el título "pl13"
                // En ComfyUI el título visible se guarda en node.title
                const targetNode = app.graph._nodes.find(n => n.title === "pl13");
                
                if (targetNode) {
                    // Centrar la vista en el nodo
                    if (app.canvas.centerOnNode) {
                        app.canvas.centerOnNode(targetNode);
                    } else {
                        // Fallback manual por si centerOnNode no está disponible
                        const canvas = app.canvas;
                        canvas.ds.offset[0] = -targetNode.pos[0] + canvas.canvas.width / 2 / canvas.ds.scale;
                        canvas.ds.offset[1] = -targetNode.pos[1] + canvas.canvas.height / 2 / canvas.ds.scale;
                        canvas.setDirty(true, true);
                    }
                    // Opcional: seleccionar el nodo visualmente
                    app.canvas.selectNode(targetNode, false);
                } else {
                    console.warn("F3: No se encontró ningún nodo con el título 'pl13'");
                }
            }
        });
    }
});
