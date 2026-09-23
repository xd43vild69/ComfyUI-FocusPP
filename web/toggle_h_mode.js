import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComfyUI-FocusPP.ToggleHandSelect",
    setup() {
        let isHandMode = false; // Empezamos asumiendo el modo de selección por defecto
        let isDispatching = false; // Evitar bucle infinito al despachar eventos

        window.addEventListener("keydown", (e) => {
            if (isDispatching) return;
            if (e.target.localName === "input" || e.target.localName === "textarea") return;

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
