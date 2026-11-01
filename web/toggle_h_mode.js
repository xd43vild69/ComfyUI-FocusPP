import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI-FocusPP.ToggleHandSelect",
    setup() {
        let isHandMode = false; // Empezamos asumiendo el modo de selección por defecto
        let isDispatching = false; // Evitar bucle infinito al despachar eventos

        window.addEventListener("keydown", (e) => {
            if (isDispatching) return;
            if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
            if (
                e.target.localName === "input" ||
                e.target.localName === "textarea" ||
                e.target.isContentEditable ||
                e.target.closest?.(".p-dialog, .p-overlaypanel, [contenteditable='true'], #focus-pp-overlay, #fpp-ac-editor-overlay, #fpp-rename-lora-overlay")
            ) {
                return;
            }

            if (e.key.toLowerCase() === 'h') {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                isHandMode = !isHandMode;
                isDispatching = true;
                
                // Despachar 'h' para Hand o 'v' para Select nativamente hacia ComfyUI
                const targetKey = isHandMode ? 'h' : 'v';
                const keyEvent = new KeyboardEvent("keydown", {
                    key: targetKey,
                    code: targetKey === 'h' ? "KeyH" : "KeyV",
                    keyCode: targetKey === 'h' ? 72 : 86,
                    bubbles: true,
                    cancelable: true
                });
                
                window.dispatchEvent(keyEvent);
                isDispatching = false;
            }
        }, { capture: true });
    }
});
