# ComfyUI-FocusPP - Custom Extensions & Shortcuts

Este Custom Node ha sido modificado y extendido para incluir varios atajos de teclado personalizados y mejoras de usabilidad (Quality of Life) en la interfaz de ComfyUI.

## ⌨️ Atajos de Teclado (Shortcuts)

- **`h` (Global)**: Actúa como un **interruptor (toggle)**. Alterna entre el **Modo Selección** (cursor normal) y el **Modo Mano** (arrastrar el lienzo). 
  *Nota: Este script sobreescribe el comportamiento nativo de la tecla `h` en ComfyUI.*

- **`F1` (Global)**: Guardar imagen con ventana **"Guardar como..."**. Busca en el flujo de trabajo el nodo preview con el título **`pi13`**, abre el diálogo del explorador para elegir ruta y nombre de archivo sin mover la cámara, y muestra una notificación visual (toast) al guardar.

- **`F2` (Dentro del Modal de Texto)**: Cuando tienes abierto el editor de texto gigante (FocusPP modal), presionar `F2` nuevamente **guardará los cambios y cerrará** la ventana automáticamente, evitando tener que usar el ratón para dar clic en el botón "Save".

- **`F3` (Global)**: Búsqueda y enfoque rápido. Busca en todo el flujo de trabajo un nodo que tenga exactamente el título **`pl13`**, centra la cámara en él de forma instantánea y lo selecciona visualmente.

- **`F4` (Global)**: Búsqueda y enfoque rápido de Multi-LoRA. Busca el nodo **`loras13`** (`FocusPP Multi-LoRA 💊`), centra la cámara en él y lo selecciona.

- **`Cmd + Shift + S` / `Ctrl + Shift + S` (Global)**: Descarga rápida de imágenes. Busca el nodo con el título **`output13`** y fuerza la descarga directa (como archivo) de todas las imágenes que estén generadas y visibles dentro de ese nodo.

---

## 💊 Nodo Integrado: `FocusPP Multi-LoRA 💊` (`FocusPP_MultiLora`)

Nodo cargador múltiple de LoRAs 100% independiente (`FocusPP_MultiLora`) con soporte de trigger words, agrupación por colores pastel según el directorio, ocultamiento de `.safetensors` y atajos de teclado cuando el nodo está seleccionado:
- **`Cmd + N` / `Ctrl + N`**: Agrega una nueva fila de LoRA y enfoca su buscador.
- **`Cmd + R` / `Ctrl + R`**: Refresca la lista de LoRAs sin recargar el navegador.
- **`Cmd + Flecha Arriba/Abajo`** (en el dropdown): Navega y selecciona entre los LoRAs de la lista desplegable (`Enter` confirma, `Esc` restaura el LoRA previo).
- **`Tab` / `Shift + Tab`** (en el campo de peso): Salta en ciclo únicamente entre los campos de peso de los LoRAs activos.
- **`Option/Alt + 1..9`** / **`Option/Alt + 0`**: Enfoca el peso del LoRA `1..9` o la caja de `trigger words` (`0`).

---

## 📂 Archivos Modificados / Agregados

- `multilora_node.py`: Backend en Python del nodo `FocusPP_MultiLora` y rutas `/focuspp/lora_list` y `/focuspp/lora_info`.
- `web/multilora.js`: Interfaz completa (`.fpp-*`), colores pastel por directorio y atajos del nodo `FocusPP_MultiLora`.
- `web/focus_pp.js`: Archivo principal. Contiene la lógica del modal de texto gigante, la intercepción de la tecla `F2` para cerrar/guardar, y el atajo global de `Cmd+Shift+S`.
- `web/toggle_h_mode.js`: Archivo inyectado para manejar exclusivamente el interruptor del modo Selección/Mano con la tecla `h`.
- `web/focus_pl13.js`: Archivo inyectado para manejar el enfoque de cámara rápido del nodo `pl13` mediante `F3`.
- `web/save_pi13.js`: Archivo inyectado para guardar la imagen del nodo preview `pi13` mediante `F1` abriendo el diálogo "Guardar como..." y mostrando confirmación en pantalla.
