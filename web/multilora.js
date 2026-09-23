import { app } from "../../scripts/app.js";

if (!window.__FOCUSPP_OWN_MULTILORA_ACTIVE__) {
window.__FOCUSPP_OWN_MULTILORA_ACTIVE__ = true;

app.registerExtension({
    name: "ComfyUI-FocusPP.MultiLora",
    
    setup() {
        const isMultiLoraType = (type) => type === "FocusPP_MultiLora" || type === "AcademiaSD_MultiLora";

        const originalRefresh = app.refreshComboInNodes;
        app.refreshComboInNodes = function() {
            let res;
            if (originalRefresh) res = originalRefresh.apply(this, arguments);
            if (app.graph) {
                for (let node of app.graph._nodes) {
                    if (isMultiLoraType(node.type) && typeof node.fetchLoras === "function") {
                        node.fetchLoras();
                    }
                }
            }
            return res;
        };

        // Atajo global F4: Buscar, centrar y seleccionar el nodo llamado "loras13"
        window.addEventListener("keydown", (e) => {
            if (e.key === "F4" || e.code === "F4") {
                if (!app.graph || !app.graph._nodes) return;

                const targetNode = app.graph._nodes.find(n => (n.title || "").trim().toLowerCase() === "loras13") ||
                                   app.graph._nodes.find(n => isMultiLoraType(n.type) && (n.title || "").toLowerCase().includes("loras13"));

                if (targetNode) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    if (document.activeElement && typeof document.activeElement.blur === "function") {
                        document.activeElement.blur();
                    }

                    if (app.canvas) {
                        if (app.canvas.deselectAllNodes) {
                            app.canvas.deselectAllNodes();
                        } else {
                            app.canvas.selected_nodes = {};
                        }

                        if (app.canvas.selectNode) {
                            app.canvas.selectNode(targetNode, false);
                        } else {
                            app.canvas.selected_nodes = { [targetNode.id]: targetNode };
                        }

                        if (app.canvas.centerOnNode) {
                            app.canvas.centerOnNode(targetNode);
                        } else if (app.canvas.ds && targetNode.pos) {
                            const canvas = app.canvas;
                            canvas.ds.offset[0] = -targetNode.pos[0] + canvas.canvas.width / 2 / canvas.ds.scale;
                            canvas.ds.offset[1] = -targetNode.pos[1] + canvas.canvas.height / 2 / canvas.ds.scale;
                        }

                        if (app.canvas.setDirty) {
                            app.canvas.setDirty(true, true);
                        }
                    }

                    if (app.graph.setDirtyCanvas) {
                        app.graph.setDirtyCanvas(true, true);
                    }
                }
            }
        }, true);
    },

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "FocusPP_MultiLora" || nodeData.name === "AcademiaSD_MultiLora") {
            
            const onSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function(o) {
                if (onSerialize) onSerialize.apply(this, arguments);
                const dataWidget = this.widgets.find(w => w.name === "lora_data");
                if (dataWidget) {
                    dataWidget.value = JSON.stringify({
                        loras: this.loraState || [],
                        triggers: this.nodeTriggers || ""
                    });
                }
            };

            const onConfigure = nodeType.prototype.onConfigure;
            nodeType.prototype.onConfigure = function(o) {
                if (onConfigure) onConfigure.apply(this, arguments);
                const injectionWidget = this.widgets?.find(w => w.name === "injection_method");
                if (injectionWidget) {
                    injectionWidget.value = "Standard (Native)";
                }
                const dataWidget = this.widgets.find(w => w.name === "lora_data");
                if (dataWidget && dataWidget.value) {
                    try {
                        const parsed = JSON.parse(dataWidget.value);
                        if (Array.isArray(parsed)) {
                            this.loraState = parsed;
                            this.nodeTriggers = "";
                        } else if (parsed && typeof parsed === "object") {
                            this.loraState = parsed.loras || [];
                            this.nodeTriggers = parsed.triggers || "";
                        }
                    } catch (e) {
                        console.error("[AcademiaSD] Error restoring state:", e);
                    }
                }
                if (this.renderUI) this.renderUI();
                if (this.forceResize) this.forceResize();
            };

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);

                const _this = this;

                const injectionWidget = this.widgets.find(w => w.name === "injection_method");
                if (injectionWidget) {
                    injectionWidget.value = "Standard (Native)";
                    injectionWidget.type = "hidden";
                    injectionWidget.computeSize = () => [0, -4];
                    injectionWidget.draw = function() {};
                    injectionWidget.serializeValue = () => "Standard (Native)";
                }

                const dataWidget = this.widgets.find(w => w.name === "lora_data");
                if (dataWidget) {
                    dataWidget.type = "hidden";
                    dataWidget.computeSize = () => [0, -4]; 
                    dataWidget.draw = function() {}; 
                    dataWidget.serializeValue = () => {
                        return JSON.stringify({
                            loras: _this.loraState || [],
                            triggers: _this.nodeTriggers || ""
                        });
                    };
                }

                if (!this.loraState) {
                    this.loraState = [];
                }

                this.size = [420, 280];
                let loraList = [];

                const container = document.createElement("div");
                container.style.cssText = `
                    width: 100%; display: flex; flex-direction: column; gap: 6px;
                    font-family: sans-serif; box-sizing: border-box; margin-top: 4px;
                    padding-bottom: 6px;
                `;

                const style = document.createElement("style");
                style.innerHTML = `
                    .fpp-switch { position: relative; display: inline-block; width: 32px; height: 16px; flex-shrink: 0;}
                    .fpp-switch input { opacity: 0; width: 0; height: 0; }
                    .fpp-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .2s; border-radius: 16px; }
                    .fpp-slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 2px; bottom: 2px; background-color: #aaa; transition: .2s; border-radius: 50%; }
                    .fpp-switch input:checked + .fpp-slider { background-color: #4a6ee0; }
                    .fpp-switch input:checked + .fpp-slider:before { transform: translateX(16px); background-color: white; }
                    
                    .fpp-lora-row { display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.3); border: 1px solid #444; border-radius: 6px; padding: 4px 6px; transition: opacity 0.2s; position: relative;}
                    .fpp-lora-row.disabled { opacity: 0.5; }
                    
                    .fpp-search-container { position: relative; flex: 1; min-width: 0; }
                    .fpp-search-input { width: 100%; padding: 4px; border: 1px solid #555; background: #111; color: #ddd; border-radius: 4px; font-size: 12px; outline: none; box-sizing: border-box; cursor: text; text-overflow: ellipsis;}
                    .fpp-search-input:focus { border-color: #4a6ee0; background: #1a1a1a; }
                    .fpp-search-list { position: absolute; top: 100%; left: 0; right: 0; background: #222; border: 1px solid #555; border-radius: 4px; max-height: 200px; overflow-y: auto; z-index: 9999; display: none; box-shadow: 0 4px 10px rgba(0,0,0,0.6); margin-top: 2px;}
                    .fpp-search-item { padding: 6px 8px; cursor: pointer; color: #ddd; font-size: 11px; word-break: break-all; border-bottom: 1px solid #333;}
                    .fpp-search-item:last-child { border-bottom: none; }
                    .fpp-search-item:hover, .fpp-search-item.active { background: rgba(74, 110, 224, 0.45) !important; color: #fff !important; box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.5); }
                    .fpp-search-item.missing { color: #ff4444; font-weight: bold; }

                    .fpp-step-btn { background: transparent; border: none; color: #888; font-size: 14px; font-weight: bold; cursor: pointer; padding: 0 4px; transition: color 0.2s; user-select: none; }
                    .fpp-step-btn:hover { color: #fff; }
                `;
                container.appendChild(style);

                if (this.nodeTriggers === undefined) {
                    this.nodeTriggers = "";
                }

                // --- CAJA DE TEXTO PARA TRIGGER WORDS (UNA SOLA LÍNEA) ---
                const txtTriggers = document.createElement("input");
                txtTriggers.type = "text";
                txtTriggers.placeholder = "Trigger words (ej: 1girl, sakura, pink hair)...";
                txtTriggers.style.cssText = "width: 100%; height: 26px; min-height: 26px; flex-shrink: 0; padding: 4px 8px; border: 1px solid #444; background: #0d0d0d; color: #eee; border-radius: 4px; font-size: 11px; font-family: inherit; outline: none; box-sizing: border-box; transition: border-color 0.2s; text-overflow: ellipsis;";
                txtTriggers.onfocus = () => { txtTriggers.style.borderColor = "#4a6ee0"; };
                txtTriggers.onblur = () => { txtTriggers.style.borderColor = "#444"; };
                txtTriggers.value = _this.nodeTriggers || "";

                txtTriggers.addEventListener("input", (e) => {
                    _this.nodeTriggers = e.target.value;
                    syncWidget();
                });

                container.appendChild(txtTriggers);

                const topBar = document.createElement("div");
                topBar.style.display = "flex"; 
                topBar.style.justifyContent = "space-between";
                topBar.style.alignItems = "center";
                topBar.style.padding = "0 2px";
                
                const toggleAllContainer = document.createElement("div");
                toggleAllContainer.style.display = "flex"; 
                toggleAllContainer.style.alignItems = "center"; 
                toggleAllContainer.style.gap = "8px";
                
                const labelToggleAll = document.createElement("label");
                labelToggleAll.className = "fpp-switch";
                const inputToggleAll = document.createElement("input");
                inputToggleAll.type = "checkbox";
                inputToggleAll.checked = true;
                const spanSliderAll = document.createElement("span");
                spanSliderAll.className = "fpp-slider";
                labelToggleAll.appendChild(inputToggleAll);
                labelToggleAll.appendChild(spanSliderAll);
                
                const textToggleAll = document.createElement("span");
                textToggleAll.innerText = "Toggle All";
                textToggleAll.style.cssText = "color: #ccc; font-size: 11px; font-weight: bold;";
                
                toggleAllContainer.appendChild(labelToggleAll);
                toggleAllContainer.appendChild(textToggleAll);

                const topActionsContainer = document.createElement("div");
                topActionsContainer.style.cssText = "display: flex; align-items: center; gap: 6px;";

                const btnRefresh = document.createElement("button");
                btnRefresh.innerText = "🔄 Refresh List";
                btnRefresh.style.cssText = "cursor: pointer; background: transparent; color: #888; border: none; font-size: 10px; padding: 2px 4px; transition: color 0.15s;";
                btnRefresh.onmouseover = () => { if (btnRefresh.innerText.includes("Refresh")) btnRefresh.style.color = "#ccc"; };
                btnRefresh.onmouseout = () => { if (btnRefresh.innerText.includes("Refresh")) btnRefresh.style.color = "#888"; };

                const btnAdd = document.createElement("button");
                btnAdd.innerText = "➕ Add";
                btnAdd.title = "Add LoRA (Cmd+N)";
                btnAdd.style.cssText = "cursor: pointer; padding: 2px 7px; background: rgba(74, 110, 224, 0.2); color: #93c5fd; border: 1px solid rgba(74, 110, 224, 0.45); border-radius: 4px; font-weight: 600; font-size: 10px; transition: all 0.15s;";
                btnAdd.onmouseover = () => {
                    btnAdd.style.background = "rgba(74, 110, 224, 0.38)";
                    btnAdd.style.color = "#fff";
                };
                btnAdd.onmouseout = () => {
                    btnAdd.style.background = "rgba(74, 110, 224, 0.2)";
                    btnAdd.style.color = "#93c5fd";
                };

                topActionsContainer.appendChild(btnRefresh);
                topActionsContainer.appendChild(btnAdd);

                topBar.appendChild(toggleAllContainer);
                topBar.appendChild(topActionsContainer);
                container.appendChild(topBar);

                this.rowsContainer = document.createElement("div");
                this.rowsContainer.style.display = "flex";
                this.rowsContainer.style.flexDirection = "column";
                this.rowsContainer.style.gap = "4px"; 
                container.appendChild(this.rowsContainer);

                const MIN_WIDTH = 260;

                const getMinHeight = () => {
                    const numRows = _this.loraState ? _this.loraState.length : (_this.rowsContainer ? _this.rowsContainer.children.length : 0);
                    const canvasTopH = 92;
                    const domH = 64 + (numRows * 34);
                    return canvasTopH + domH;
                };

                this.computeSize = function(out) {
                    return [MIN_WIDTH, getMinHeight()];
                };

                const originalOnResize = this.onResize;
                this.onResize = function(size) {
                    const minH = getMinHeight();
                    if (size[0] < MIN_WIDTH) size[0] = MIN_WIDTH;
                    if (size[1] < minH) size[1] = minH;
                    if (originalOnResize) originalOnResize.apply(this, arguments);
                };

                let lastRowCount = -1;
                const forceResize = (onlyIfRowsChanged = false) => {
                    const numRows = _this.loraState ? _this.loraState.length : 0;
                    const minH = getMinHeight();
                    const currentW = Math.max(_this.size ? _this.size[0] : 420, MIN_WIDTH);
                    let targetH = _this.size ? _this.size[1] : minH;

                    if (!onlyIfRowsChanged || numRows !== lastRowCount || targetH < minH) {
                        targetH = minH;
                        lastRowCount = numRows;
                    }

                    _this.size = [currentW, targetH];
                    app.graph.setDirtyCanvas(true, true);
                };
                this.forceResize = forceResize;

                // --- NUEVA ARQUITECTURA DE DATOS REACTIVA ---
                const syncWidget = () => {
                    if (dataWidget) {
                        dataWidget.value = JSON.stringify({
                            loras: _this.loraState || [],
                            triggers: _this.nodeTriggers || ""
                        });
                    }
                    if (_this.properties) {
                        _this.properties.triggers = _this.nodeTriggers || "";
                    }
                    app.graph.setDirtyCanvas(true, false);
                };

                const moveLora = (fromIdx, toIdx) => {
                    if (toIdx < 0 || toIdx >= _this.loraState.length) return;
                    const item = _this.loraState.splice(fromIdx, 1)[0];
                    _this.loraState.splice(toIdx, 0, item);
                    syncWidget();
                    _this.renderUI();
                };

                const checkToggleAll = () => {
                    if (_this.loraState.length === 0) return;
                    let allChecked = true;
                    let allUnchecked = true;
                    _this.loraState.forEach(l => {
                        if (l.enabled) allUnchecked = false;
                        else allChecked = false;
                    });
                    if (allChecked) inputToggleAll.checked = true;
                    else if (allUnchecked) inputToggleAll.checked = false;
                };

                inputToggleAll.addEventListener("change", (e) => {
                    const state = e.target.checked;
                    _this.loraState.forEach(l => l.enabled = state);
                    syncWidget();
                    _this.renderUI();
                });

                const PASTEL_PALETTE = [
                    { text: "#bae6fd", dirText: "#7dd3fc", bg: "rgba(125, 211, 252, 0.10)", border: "#38bdf8" }, // Sky Blue
                    { text: "#a7f3d0", dirText: "#6ee7b7", bg: "rgba(110, 231, 183, 0.10)", border: "#34d399" }, // Mint Green
                    { text: "#ddd6fe", dirText: "#c4b5fd", bg: "rgba(196, 181, 253, 0.10)", border: "#a78bfa" }, // Lavender
                    { text: "#fde68a", dirText: "#fcd34d", bg: "rgba(252, 211, 77, 0.10)",  border: "#fbbf24" }, // Pastel Amber
                    { text: "#fbcfe8", dirText: "#f9a8d4", bg: "rgba(249, 168, 212, 0.10)", border: "#f472b6" }, // Pastel Rose
                    { text: "#a5f3fc", dirText: "#67e8f9", bg: "rgba(103, 232, 249, 0.10)", border: "#22d3ee" }, // Cyan / Aqua
                    { text: "#fed7aa", dirText: "#fdba74", bg: "rgba(253, 186, 116, 0.10)", border: "#fb923c" }, // Peach / Apricot
                    { text: "#d9f99d", dirText: "#bef264", bg: "rgba(190, 242, 100, 0.10)", border: "#a3e635" }, // Lime Pastel
                    { text: "#f5d0fe", dirText: "#f0abfc", bg: "rgba(240, 171, 252, 0.10)", border: "#e879f9" }, // Lilac / Orchid
                    { text: "#fecdd3", dirText: "#fda4af", bg: "rgba(253, 164, 175, 0.10)", border: "#fb7185" }, // Coral
                    { text: "#c7d2fe", dirText: "#a5b4fc", bg: "rgba(165, 180, 252, 0.10)", border: "#818cf8" }, // Periwinkle
                    { text: "#99f6e4", dirText: "#5eead4", bg: "rgba(94, 234, 212, 0.10)",  border: "#2dd4bf" }  // Teal
                ];

                const dirColorMap = new Map();

                const formatLoraDisplayName = (name) => {
                    if (!name) return "";
                    return String(name).replace(/\.safetensors$/i, "");
                };

                const splitLoraPath = (rawName) => {
                    const display = formatLoraDisplayName(rawName);
                    const lastSlash = Math.max(display.lastIndexOf("/"), display.lastIndexOf("\\"));
                    if (lastSlash === -1) {
                        return { dir: "", dirKey: "", base: display, fullDisplay: display };
                    }
                    return {
                        dir: display.slice(0, lastSlash + 1),
                        dirKey: display.slice(0, lastSlash).replace(/\\/g, "/").toLowerCase(),
                        base: display.slice(lastSlash + 1),
                        fullDisplay: display
                    };
                };

                const getDirectoryPalette = (rawName) => {
                    const { dirKey } = splitLoraPath(rawName);
                    if (!dirKey) return null;
                    if (!dirColorMap.has(dirKey)) {
                        const nextColor = PASTEL_PALETTE[dirColorMap.size % PASTEL_PALETTE.length];
                        dirColorMap.set(dirKey, nextColor);
                    }
                    return dirColorMap.get(dirKey);
                };

                const applyInputPastelStyle = (inputEl, rawName) => {
                    const palette = getDirectoryPalette(rawName);
                    if (palette) {
                        inputEl.style.color = palette.text;
                        inputEl.style.borderLeft = `3px solid ${palette.border}`;
                    } else {
                        inputEl.style.color = "#ddd";
                        inputEl.style.borderLeft = "1px solid #555";
                    }
                };

                const renderLoraOptionContent = (optEl, rawName, isMissing = false) => {
                    if (isMissing) {
                        optEl.textContent = formatLoraDisplayName(rawName) + " (Missing/Pending)";
                        return;
                    }
                    const { dir, base } = splitLoraPath(rawName);
                    const palette = getDirectoryPalette(rawName);
                    optEl.innerHTML = "";
                    if (palette && dir) {
                        optEl.style.backgroundColor = palette.bg;
                        optEl.style.borderLeft = `3px solid ${palette.border}`;
                        const dirSpan = document.createElement("span");
                        dirSpan.style.cssText = `color: ${palette.dirText}; opacity: 0.85; font-weight: 600;`;
                        dirSpan.textContent = dir;
                        const baseSpan = document.createElement("span");
                        baseSpan.style.cssText = `color: ${palette.text}; font-weight: 500;`;
                        baseSpan.textContent = base;
                        optEl.appendChild(dirSpan);
                        optEl.appendChild(baseSpan);
                    } else {
                        optEl.style.borderLeft = "3px solid transparent";
                        optEl.style.color = "#e2e8f0";
                        optEl.textContent = base;
                    }
                };

                const resolveCanonicalLoraName = (rawName) => {
                    if (!rawName || rawName === "None") return rawName;
                    if (loraList.includes(rawName)) return rawName;
                    const targetClean = formatLoraDisplayName(rawName).replace(/\\/g, "/").toLowerCase();
                    const found = loraList.find(l => formatLoraDisplayName(l).replace(/\\/g, "/").toLowerCase() === targetClean);
                    return found || rawName;
                };

                this.fetchLoras = async function() {
                    const endpoints = ["/focuspp/lora_list", "/academia/lora_list", "/models/loras"];
                    let loaded = null;

                    for (const url of endpoints) {
                        try {
                            const res = await fetch(url);
                            if (res.ok) {
                                const data = await res.json();
                                if (Array.isArray(data)) {
                                    loaded = data;
                                    break;
                                }
                            }
                        } catch (e) {}
                    }

                    if (!loaded) {
                        try {
                            const res = await fetch("/object_info/LoraLoader");
                            if (res.ok) {
                                const info = await res.json();
                                const list = info?.LoraLoader?.input?.required?.lora_name?.[0];
                                if (Array.isArray(list)) loaded = list;
                            }
                        } catch (e) {}
                    }

                    if (Array.isArray(loaded)) {
                        loraList = loaded;
                        dirColorMap.clear();
                        loraList.forEach(loraName => getDirectoryPalette(loraName));
                        // Normalizar cualquier LoRA guardado sin .safetensors
                        if (Array.isArray(_this.loraState)) {
                            let updated = false;
                            _this.loraState.forEach(item => {
                                if (item && item.name) {
                                    const canonical = resolveCanonicalLoraName(item.name);
                                    if (canonical !== item.name) {
                                        item.name = canonical;
                                        updated = true;
                                    }
                                }
                            });
                            if (updated) syncWidget();
                        }
                        _this.renderUI();
                    }
                };


                this.renderUI = () => {
                    if (txtTriggers && txtTriggers.value !== (_this.nodeTriggers || "")) {
                        txtTriggers.value = _this.nodeTriggers || "";
                    }
                    _this.rowsContainer.innerHTML = "";

                    _this.loraState.forEach((item, idx) => {
                        if (item && item.name && loraList.length > 0) {
                            item.name = resolveCanonicalLoraName(item.name);
                        }
                        const row = document.createElement("div");
                        row.className = "fpp-lora-row";
                        row.style.zIndex = 1000 - idx; 
                        
                        const isEnabled = item.enabled !== undefined ? item.enabled : true;
                        if(!isEnabled) row.classList.add("disabled");

                        const labelToggle = document.createElement("label");
                        labelToggle.className = "fpp-switch";
                        const inputToggle = document.createElement("input");
                        inputToggle.type = "checkbox";
                        inputToggle.className = "lora-toggle";
                        inputToggle.checked = isEnabled;
                        const spanSlider = document.createElement("span");
                        spanSlider.className = "fpp-slider";
                        labelToggle.appendChild(inputToggle);
                        labelToggle.appendChild(spanSlider);

                        const searchContainer = document.createElement("div");
                        searchContainer.className = "fpp-search-container";

                        const inputSearch = document.createElement("input");
                        inputSearch.type = "text";
                        inputSearch.className = "fpp-search-input";
                        inputSearch.placeholder = "Type to search LoRA...";
                        inputSearch.value = formatLoraDisplayName(item.name || "");
                        applyInputPastelStyle(inputSearch, item.name || "");

                        const dropdownList = document.createElement("div");
                        dropdownList.className = "fpp-search-list";

                        let activeDropdownIndex = -1;
                        let initialAssignedValue = item.name || "";

                        const setSelectedLora = (rawLoraName) => {
                            _this.loraState[idx].name = rawLoraName;
                            inputSearch.value = formatLoraDisplayName(rawLoraName);
                            applyInputPastelStyle(inputSearch, rawLoraName);
                            syncWidget();
                        };

                        const updateActiveDropdownItem = (items, newIndex, applySelection = true) => {
                            if (!items || items.length === 0) return;
                            items.forEach(el => el.classList.remove("active"));
                            activeDropdownIndex = ((newIndex % items.length) + items.length) % items.length;
                            const activeEl = items[activeDropdownIndex];
                            if (activeEl) {
                                activeEl.classList.add("active");
                                activeEl.scrollIntoView({ block: "nearest" });
                                if (applySelection && activeEl.dataset.value) {
                                    setSelectedLora(activeEl.dataset.value);
                                }
                            }
                        };

                        const populateDropdown = (filterText) => {
                            dropdownList.innerHTML = "";
                            activeDropdownIndex = -1;
                            const lowerFilter = formatLoraDisplayName(filterText).toLowerCase();
                            let matchCount = 0;

                            const currentVal = resolveCanonicalLoraName(_this.loraState[idx]?.name || "");
                            if (currentVal && _this.loraState[idx]) {
                                _this.loraState[idx].name = currentVal;
                            }
                            if (currentVal && !loraList.includes(currentVal) && currentVal !== "None") {
                                const opt = document.createElement("div");
                                opt.className = "fpp-search-item missing";
                                opt.dataset.value = currentVal;
                                renderLoraOptionContent(opt, currentVal, true);
                                opt.addEventListener("mousedown", () => {
                                    initialAssignedValue = currentVal;
                                    dropdownList.style.display = "none";
                                    setSelectedLora(currentVal);
                                });
                                dropdownList.appendChild(opt);
                                matchCount++;
                            }

                            loraList.forEach(loraName => {
                                const displayLora = formatLoraDisplayName(loraName);
                                if (displayLora.toLowerCase().includes(lowerFilter)) {
                                    const opt = document.createElement("div");
                                    opt.className = "fpp-search-item";
                                    opt.dataset.value = loraName;
                                    renderLoraOptionContent(opt, loraName, false);

                                    opt.addEventListener("mousedown", () => {
                                        initialAssignedValue = loraName;
                                        dropdownList.style.display = "none";
                                        setSelectedLora(loraName);
                                    });
                                    dropdownList.appendChild(opt);
                                    matchCount++;
                                }
                            });

                            if (matchCount === 0) {
                                const noRes = document.createElement("div");
                                noRes.style.cssText = "padding: 6px 8px; color: #777; font-size: 11px; text-align: center;";
                                noRes.innerText = "No matches found";
                                dropdownList.appendChild(noRes);
                            } else {
                                const items = Array.from(dropdownList.querySelectorAll(".fpp-search-item[data-value]"));
                                const existingIdx = items.findIndex(el => el.dataset.value === currentVal);
                                if (existingIdx !== -1) {
                                    updateActiveDropdownItem(items, existingIdx, false);
                                }
                            }
                        };

                        inputSearch.addEventListener("focus", () => {
                            initialAssignedValue = _this.loraState[idx]?.name || "";
                            populateDropdown(""); 
                            dropdownList.style.display = "block";
                            row.style.zIndex = 2000; 
                        });

                        inputSearch.addEventListener("input", (e) => {
                            const typed = e.target.value;
                            populateDropdown(typed);
                            dropdownList.style.display = "block";
                            const matchedRaw = loraList.find(l => formatLoraDisplayName(l).toLowerCase() === typed.trim().toLowerCase());
                            _this.loraState[idx].name = matchedRaw || typed;
                            applyInputPastelStyle(inputSearch, _this.loraState[idx].name);
                            syncWidget();
                        });

                        inputSearch.addEventListener("keydown", (e) => {
                            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();

                                if (dropdownList.style.display === "none") {
                                    initialAssignedValue = _this.loraState[idx]?.name || "";
                                    populateDropdown("");
                                    dropdownList.style.display = "block";
                                    row.style.zIndex = 2000;
                                }

                                const items = Array.from(dropdownList.querySelectorAll(".fpp-search-item[data-value]"));
                                if (items.length === 0) return;

                                let nextIdx;
                                if (activeDropdownIndex === -1) {
                                    const currentIdx = items.findIndex(el => el.dataset.value === (_this.loraState[idx]?.name || ""));
                                    if (currentIdx !== -1) {
                                        nextIdx = e.key === "ArrowDown" ? currentIdx + 1 : currentIdx - 1;
                                    } else {
                                        nextIdx = e.key === "ArrowDown" ? 0 : items.length - 1;
                                    }
                                } else {
                                    nextIdx = e.key === "ArrowDown" ? activeDropdownIndex + 1 : activeDropdownIndex - 1;
                                }

                                updateActiveDropdownItem(items, nextIdx, true);
                            } else if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                initialAssignedValue = _this.loraState[idx]?.name || "";
                                dropdownList.style.display = "none";
                                inputSearch.blur();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();

                                if (initialAssignedValue) {
                                    setSelectedLora(initialAssignedValue);
                                }
                                dropdownList.style.display = "none";
                                inputSearch.blur();
                            }
                        });

                        inputSearch.addEventListener("blur", () => {
                            row.style.zIndex = 1000 - idx;
                            setTimeout(() => { dropdownList.style.display = "none"; }, 150);
                        });

                        searchContainer.appendChild(inputSearch);
                        searchContainer.appendChild(dropdownList);

                        const strengthContainer = document.createElement("div");
                        strengthContainer.style.cssText = "display: flex; align-items: center; background: rgba(0,0,0,0.4); border-radius: 4px; padding: 0 2px;";

                        const btnMinus = document.createElement("button");
                        btnMinus.innerText = "-";
                        btnMinus.className = "fpp-step-btn";

                        const inputStrength = document.createElement("input");
                        inputStrength.type = "text";  
                        inputStrength.className = "lora-strength";
                        
                        let initialValue = parseFloat(item.strength !== undefined ? item.strength : 1.0);
                        if (isNaN(initialValue)) initialValue = 1.0;
                        inputStrength.value = initialValue.toFixed(2);
                        
                        inputStrength.style.cssText = "width: 40px; padding: 4px 0; border: none; background: transparent; color: white; outline: none; text-align: center; font-family: monospace; font-size: 13px; font-weight: bold;";

                        const btnPlus = document.createElement("button");
                        btnPlus.innerText = "+";
                        btnPlus.className = "fpp-step-btn";

                        const adjustValue = (amount) => {
                            let val = parseFloat(inputStrength.value);
                            if (isNaN(val)) val = 0.0;
                            val += amount;
                            inputStrength.value = val.toFixed(2);
                            _this.loraState[idx].strength = val;
                            syncWidget();
                        };

                        btnMinus.addEventListener("click", () => adjustValue(-0.05));
                        btnPlus.addEventListener("click", () => adjustValue(0.05));

                        inputStrength.addEventListener("input", function() {
                            this.value = this.value.replace(/,/g, '.');
                            this.value = this.value.replace(/(?!^-)[^0-9.]/g, '');
                            if ((this.value.match(/\./g) || []).length > 1) {
                                this.value = this.value.slice(0, -1);
                            }
                        });

                        inputStrength.addEventListener("focus", function() {
                            this.style.background = "rgba(74, 110, 224, 0.4)";
                            this.style.borderRadius = "3px";
                            this.select();
                        });

                        inputStrength.addEventListener("keydown", function(e) {
                            if (e.key === "Tab") {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();

                                const allRows = Array.from(_this.rowsContainer.children);
                                const total = allRows.length;
                                if (total > 0) {
                                    const step = e.shiftKey ? -1 : 1;
                                    for (let offset = 1; offset <= total; offset++) {
                                        const candidateIdx = ((idx + offset * step) % total + total) % total;
                                        const isCandidateEnabled = _this.loraState[candidateIdx]?.enabled !== false;
                                        if (isCandidateEnabled) {
                                            const targetInput = allRows[candidateIdx]?.querySelector(".lora-strength");
                                            if (targetInput) {
                                                targetInput.focus();
                                                targetInput.select();
                                            }
                                            break;
                                        }
                                    }
                                }
                            } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                adjustValue(e.shiftKey ? 0.2 : 0.05);
                            } else if (e.key === "ArrowDown") {
                                e.preventDefault();
                                adjustValue(e.shiftKey ? -0.2 : -0.05);
                            } else if (e.key === "Enter") {
                                this.blur();
                            }
                        });

                        inputStrength.addEventListener("blur", function() {
                            this.style.background = "transparent";
                            let parsed = parseFloat(this.value);
                            if (isNaN(parsed)) parsed = 0.0;
                            this.value = parsed.toFixed(2);
                            _this.loraState[idx].strength = parsed;
                            syncWidget();
                        });

                        strengthContainer.appendChild(btnMinus);
                        strengthContainer.appendChild(inputStrength);
                        strengthContainer.appendChild(btnPlus);

                        const btnDelete = document.createElement("button");
                        btnDelete.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg>`;
                        btnDelete.style.cssText = "background: transparent; border: none; color: #666; cursor: pointer; padding: 0 0 0 4px; display: flex; align-items: center; transition: color 0.2s;";
                        btnDelete.onmouseover = () => btnDelete.style.color = "#ff4444";
                        btnDelete.onmouseout = () => btnDelete.style.color = "#666";
                        
                        inputToggle.addEventListener("change", (e) => {
                            _this.loraState[idx].enabled = e.target.checked;
                            if(e.target.checked) row.classList.remove("disabled");
                            else row.classList.add("disabled");
                            syncWidget();
                            checkToggleAll();
                        });
                        
                        btnDelete.addEventListener("click", () => {
                            _this.loraState.splice(idx, 1);
                            syncWidget();
                            _this.renderUI();
                        });

                        // Botones para reordenar arriba/abajo
                        const orderContainer = document.createElement("div");
                        orderContainer.style.cssText = "display: flex; flex-direction: column; justify-content: center; gap: 1px; margin: 0 1px;";

                        const btnUp = document.createElement("button");
                        btnUp.type = "button";
                        btnUp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>`;
                        btnUp.title = "Subir (Move Up)";
                        btnUp.style.cssText = `background: transparent; border: none; color: ${idx === 0 ? '#333' : '#777'}; cursor: ${idx === 0 ? 'default' : 'pointer'}; padding: 1px 2px; display: flex; align-items: center; justify-content: center; line-height: 1; transition: color 0.15s;`;
                        if (idx > 0) {
                            btnUp.onmouseover = () => btnUp.style.color = "#fff";
                            btnUp.onmouseout = () => btnUp.style.color = "#777";
                            btnUp.addEventListener("click", () => moveLora(idx, idx - 1));
                        }

                        const btnDown = document.createElement("button");
                        btnDown.type = "button";
                        btnDown.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
                        btnDown.title = "Bajar (Move Down)";
                        const isLast = idx === _this.loraState.length - 1;
                        btnDown.style.cssText = `background: transparent; border: none; color: ${isLast ? '#333' : '#777'}; cursor: ${isLast ? 'default' : 'pointer'}; padding: 1px 2px; display: flex; align-items: center; justify-content: center; line-height: 1; transition: color 0.15s;`;
                        if (!isLast) {
                            btnDown.onmouseover = () => btnDown.style.color = "#fff";
                            btnDown.onmouseout = () => btnDown.style.color = "#777";
                            btnDown.addEventListener("click", () => moveLora(idx, idx + 1));
                        }

                        orderContainer.appendChild(btnUp);
                        orderContainer.appendChild(btnDown);

                        // Click derecho sobre la fila para mostrar menú contextual (estilo Power Lora Loader rgthree)
                        row.addEventListener("contextmenu", (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (window.LiteGraph && window.LiteGraph.ContextMenu) {
                                const canMoveUp = idx > 0;
                                const canMoveDown = idx < _this.loraState.length - 1;
                                new LiteGraph.ContextMenu([
                                    {
                                        content: "⬆️ Move Up",
                                        disabled: !canMoveUp,
                                        callback: () => moveLora(idx, idx - 1)
                                    },
                                    {
                                        content: "⬇️ Move Down",
                                        disabled: !canMoveDown,
                                        callback: () => moveLora(idx, idx + 1)
                                    },
                                    null,
                                    {
                                        content: isEnabled ? "⚫ Desactivar" : "🟢 Activar",
                                        callback: () => {
                                            _this.loraState[idx].enabled = !isEnabled;
                                            syncWidget();
                                            _this.renderUI();
                                        }
                                    },
                                    {
                                        content: "🗑️ Remove",
                                        callback: () => {
                                            _this.loraState.splice(idx, 1);
                                            syncWidget();
                                            _this.renderUI();
                                        }
                                    }
                                ], {
                                    event: e,
                                    title: item.name ? item.name.split(/[/\\]/).pop() : "LoRA Options"
                                });
                            }
                        });

                        row.appendChild(labelToggle);
                        row.appendChild(searchContainer);
                        row.appendChild(strengthContainer);
                        row.appendChild(orderContainer);
                        row.appendChild(btnDelete);
                        
                        _this.rowsContainer.appendChild(row);
                    });

                    checkToggleAll();
                    forceResize(true);
                }; 

                const addNewLora = (focusNewInput = false) => {
                    const defaultName = loraList.length > 0 ? loraList[0] : "";
                    _this.loraState.push({ enabled: true, name: defaultName, strength: 1.0 });
                    syncWidget();
                    _this.renderUI();
                    if (focusNewInput && _this.rowsContainer && _this.rowsContainer.lastElementChild) {
                        const newSearchInput = _this.rowsContainer.lastElementChild.querySelector(".fpp-search-input");
                        if (newSearchInput) {
                            setTimeout(() => {
                                newSearchInput.focus();
                                newSearchInput.select();
                            }, 20);
                        }
                    }
                };

                btnAdd.addEventListener("click", () => addNewLora(false));
                
                const triggerRefreshWithFeedback = async () => {
                    const origText = "🔄 Refresh List";
                    btnRefresh.innerText = "⏳ Refreshing...";
                    btnRefresh.style.color = "#60a5fa";
                    await _this.fetchLoras();
                    btnRefresh.innerText = "✅ Refreshed!";
                    btnRefresh.style.color = "#4ade80";
                    setTimeout(() => {
                        btnRefresh.innerText = origText;
                        btnRefresh.style.color = "#888";
                    }, 1200);
                };

                btnRefresh.addEventListener("click", () => triggerRefreshWithFeedback());

                container.addEventListener("mousedown", (e) => {
                    // Permitir que el clic pase al canvas de LiteGraph si el usuario arrastra cerca de la esquina inferior derecha (resize handle)
                    const rect = container.getBoundingClientRect();
                    if (rect.right - e.clientX <= 22 && rect.bottom - e.clientY <= 22) {
                        return;
                    }
                    e.stopPropagation();
                });

                const domWidget = this.addDOMWidget("UI", "HTML", container);
                if (domWidget) {
                    domWidget.computeSize = function(width) {
                        const numRows = _this.loraState ? _this.loraState.length : 0;
                        return [MIN_WIDTH, 64 + (numRows * 34)];
                    };
                }
                
                const existingTooltip = document.getElementById("fpp-lora-tooltip");
                if (existingTooltip) {
                    existingTooltip.remove();
                }

                // --- ACCESOS DIRECTOS DE TECLADO ---
                const onKeyDownCapture = (e) => {
                    if (!_this.graph) return;
                    const isSelected =
                        (app.canvas && app.canvas.selected_nodes && app.canvas.selected_nodes[_this.id]) ||
                        container.contains(document.activeElement);
                    if (!isSelected) return;

                    // Cmd + N (o Ctrl + N) sin Shift: Agregar un nuevo LoRA bloqueando nueva ventana del navegador
                    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === "n" || e.code === "KeyN")) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        addNewLora(true);
                        return;
                    }

                    // Cmd + R (o Ctrl + R) sin Shift: Refrescar lista de LoRAs bloqueando la recarga del navegador
                    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === "r" || e.code === "KeyR")) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        triggerRefreshWithFeedback();
                        return;
                    }

                    // Option / Alt + número (1..9) enfoca el campo de fuerza del LoRA correspondiente
                    if (e.altKey && !e.ctrlKey && !e.metaKey) {
                        let digit = -1;
                        if (e.code && e.code.startsWith("Digit")) {
                            digit = parseInt(e.code.replace("Digit", ""));
                        } else if (e.key >= "0" && e.key <= "9") {
                            digit = parseInt(e.key);
                        }

                        if (digit >= 1 && digit <= 9) {
                            const loraIdx = digit - 1;
                            if (_this.rowsContainer && _this.rowsContainer.children[loraIdx]) {
                                e.preventDefault();
                                e.stopPropagation();
                                e.stopImmediatePropagation();

                                const targetRow = _this.rowsContainer.children[loraIdx];
                                const strengthInput = targetRow.querySelector(".lora-strength");
                                if (strengthInput) {
                                    strengthInput.focus();
                                    strengthInput.select();
                                }
                            }
                        } else if (digit === 0) {
                            // Option + 0 enfoca la caja de trigger words
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            if (txtTriggers) {
                                txtTriggers.focus();
                                txtTriggers.select();
                            }
                        }
                    }
                };

                window.addEventListener("keydown", onKeyDownCapture, true);

                const origOnRemoved = this.onRemoved;
                this.onRemoved = function() {
                    window.removeEventListener("keydown", onKeyDownCapture, true);
                    if (origOnRemoved) origOnRemoved.apply(this, arguments);
                };

                // INICIALIZACIÓN
                this.fetchLoras().then(() => {
                    if (dataWidget && dataWidget.value) {
                        try {
                            const savedData = JSON.parse(dataWidget.value);
                            if (Array.isArray(savedData)) {
                                _this.loraState = savedData;
                                _this.nodeTriggers = "";
                            } else if (savedData && typeof savedData === "object") {
                                _this.loraState = savedData.loras || [];
                                _this.nodeTriggers = savedData.triggers || "";
                            }
                            if (txtTriggers) {
                                txtTriggers.value = _this.nodeTriggers || "";
                            }
                        } catch (e) {}
                    }
                    _this.renderUI();
                    if (_this.forceResize) _this.forceResize();
                });
            };
        }
    }
});
}