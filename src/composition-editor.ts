import { attachAnnotations, type AnnotationAttachment, type AnnotationTool } from "./annotation";
import { clientToCanvasPoint, resizedAspectWidth } from "./shared/editor-geometry";

type CompositionSource = { width: number; height: number; label: string };

type PlacedItem = {
  source: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutSnapshot = {
  items: PlacedItem[];
  selectedSource: number | null;
};

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS(svg.namespaceURI, "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

export function showCompositionEditor(
  sources: CompositionSource[],
  bitmaps: ImageBitmap[],
  close: () => void,
) {
  const host = document.createElement("precision-composition");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{color-scheme:light dark}*{box-sizing:border-box}
    .panel{position:fixed;inset:20px;display:grid;grid-template-rows:64px minmax(0,1fr) 64px;background:#f7f7f5;color:#202124;border:1px solid #d9dadd;border-radius:14px;box-shadow:0 24px 72px #0003;overflow:hidden;font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    header,footer{display:flex;align-items:center;gap:12px;padding:0 20px;background:#fff;border-color:#e5e5e3}header{border-bottom:1px solid #e5e5e3}footer{justify-content:space-between;border-top:1px solid #e5e5e3}
    .identity{display:grid;gap:1px;min-width:0}.title{font-size:15px;font-weight:650;letter-spacing:-.2px}.subtitle,.status{color:#73757a;font-size:12px}
    .zoom{display:flex;align-items:center;gap:3px;margin-left:auto;padding:3px;background:#f3f3f1;border:1px solid #e5e5e3;border-radius:8px}.button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:0 11px;color:#313338;background:#fff;border:1px solid #d5d6d8;border-radius:7px;font:500 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer;white-space:nowrap}.button:hover{background:#f2f3f4;border-color:#b9bbbf}.button:disabled{opacity:.42;cursor:default}.button:focus-visible{outline:2px solid #4b83e6;outline-offset:2px}.button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .zoom-button{display:grid;place-items:center;min-width:30px;height:30px;padding:0;background:transparent;border:0;border-radius:5px}.zoom-button:hover{background:#e8e9e9}.zoom-value{min-width:48px;font-variant-numeric:tabular-nums}
    .workspace{display:grid;grid-template-columns:minmax(0,1fr) 250px;min-width:0;min-height:0;background:#eee}
    .viewport{position:relative;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px;scrollbar-color:#a9aaad transparent;scrollbar-width:thin;display:flex;flex-direction:column;align-items:center}
    .annotation-tools{position:sticky;top:0;z-index:3;order:1;align-self:flex-start;display:flex;align-items:center;gap:4px;max-width:100%;margin:0 0 12px;padding:6px;background:#fff;border:1px solid #e0e1e3;border-radius:10px;box-shadow:0 4px 16px #0002}
    .annotation-list{position:absolute;top:8px;right:8px;z-index:4;max-width:min(260px,calc(100% - 64px));max-height:50%;overflow:auto;padding:6px 9px;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:8px;box-shadow:0 3px 14px #0002;font-size:12px;pointer-events:none}.annotation-list summary,.annotation-list button{pointer-events:auto}.annotation-list summary{cursor:pointer;font-weight:600}.annotation-list ul{display:grid;gap:4px;max-height:180px;overflow:auto;margin:6px 0 0;padding:0;list-style:none}.annotation-list button{max-width:100%;padding:5px 7px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:5px;background:Canvas;color:CanvasText;text-align:left;font:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.annotation-list button[aria-pressed=true]{outline:2px solid #4b83e6}
    .annotation-tools .tool-button{display:grid;place-items:center;width:34px;height:34px;padding:0;color:#474a50;background:transparent;border:1px solid transparent;border-radius:7px;cursor:pointer}
    .annotation-tools .tool-button:hover{background:#f1f2f3}.annotation-tools .tool-button[aria-pressed=true]{color:#205fc2;background:#edf3ff;border-color:#d7e4fb}
    .annotation-tools .tool-button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .annotation-tools input[type=color]{width:30px;height:30px;padding:2px;border:1px solid #d7d8da;border-radius:7px;background:#fff;cursor:pointer}
    .canvas-text-input{position:absolute;z-index:5;min-width:1em;height:auto;padding:0;color:inherit;background:transparent;border:0;border-radius:0;box-shadow:none;outline:0;font:600 16px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;caret-color:currentColor;text-shadow:0 1px 2px #0008}
    @media(prefers-color-scheme:dark){.annotation-tools{background:#292b2e;border-color:#414348;box-shadow:0 4px 16px #0006}.annotation-tools .tool-button{color:#d1d3d7}.annotation-tools .tool-button:hover{background:#383a3e}.annotation-tools .tool-button[aria-pressed=true]{color:#a9c7ff;background:#253a5f;border-color:#365681}.annotation-tools input[type=color]{background:#292b2e;border-color:#55585d}.canvas-text-input{color:#f1f3f4;text-shadow:0 1px 2px #000b}}
    .canvas-wrap{order:2;width:max-content;height:max-content;min-width:100%;min-height:100%;display:grid;place-items:center}
    canvas{display:block;max-width:none;max-height:none;width:auto;height:auto;background:#fff;box-shadow:0 6px 24px #0002;touch-action:none;cursor:default}
    aside{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-width:0;min-height:0;padding:16px;background:#fff;border-left:1px solid #e2e2df}.aside-title{margin:0 0 10px;font-size:12px;font-weight:650}.layers{display:flex;flex-direction:column;gap:4px;overflow:auto}.layer{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:0 9px;text-align:left;background:#fff;border:1px solid transparent;border-radius:6px;color:#45474b;font:12px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer}.layer:hover{background:#f5f5f4}.layer[aria-pressed=true]{background:#edf3ff;border-color:#d3e2ff;color:#174da8}.layer-number{display:grid;place-items:center;width:20px;height:20px;flex:none;border-radius:5px;background:#f0f0ee;color:#666;font-size:10px}.layer-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.inspector{display:grid;gap:7px;min-width:0;padding-top:12px;border-top:1px solid #e6e6e3}.selection-label{min-height:18px;color:#777a80;font-size:11px}.arrange{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;min-width:0}.arrange .button{min-width:0;padding:4px 6px;font-size:11px;line-height:1.25;white-space:normal}.inspector>.button{width:100%;min-width:0;white-space:normal}.danger{color:#a3282d}.danger:hover{background:#fff3f3;border-color:#edc6c8}
    .status{min-height:18px}.actions{display:flex;align-items:center;gap:8px}.primary{color:#fff;background:#1f2937;border-color:#1f2937}.primary:hover{background:#111827;border-color:#111827}
    @media(prefers-color-scheme:dark){.panel{background:#202124;color:#f1f3f4;border-color:#3b3d40}header,footer,aside{background:#252629;border-color:#3b3d40}.subtitle,.status,.selection-label{color:#aeb0b5}.zoom{background:#292b2e;border-color:#414348}.zoom-button{color:#d1d3d7}.zoom-button:hover{background:#383a3e}.button{color:#e1e3e6;background:#292b2e;border-color:#4a4c50}.button:hover{background:#35373b;border-color:#65676d}.button.primary{color:#202124;background:#e8eaed;border-color:#e8eaed}.button.primary:hover{background:#fff}.workspace{background:#1b1c1e}.layer{background:transparent;color:#d1d3d7}.layer:hover{background:#303236}.layer[aria-pressed=true]{color:#a9c7ff;background:#253a5f;border-color:#365681}.layer-number{background:#36383c;color:#c8cbd0}.inspector{border-color:#414348}.danger{color:#ff9a9d}.danger:hover{background:#472e30;border-color:#73484b}canvas{box-shadow:0 6px 24px #0007}}
    @media(max-width:760px){.panel{inset:8px;grid-template-rows:58px minmax(0,1fr) auto;border-radius:10px}header{padding:0 12px;gap:7px}.workspace{grid-template-columns:minmax(0,1fr)}aside{grid-row:2;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr);gap:8px 12px;padding:9px 12px;border-left:0;border-top:1px solid #e2e2df}.aside-title{margin:0}.layers{grid-row:2;flex-direction:row;align-items:start}.layer{width:auto;min-width:95px}.inspector{grid-row:1/3;grid-column:2;align-self:stretch;min-width:120px;padding:0 0 0 10px;border-top:0;border-left:1px solid #e6e6e3}.selection-label{display:none}.arrange{grid-template-columns:1fr}.arrange .button{min-height:28px}.viewport{padding:14px}.panel{grid-template-rows:58px minmax(0,1fr) 132px}footer{padding:8px 12px;gap:8px}.status{display:none}.actions{margin-left:auto}.button{min-height:32px;padding:0 8px}}
    @media(max-width:420px){.panel{grid-template-rows:52px minmax(0,1fr) 138px}header{padding:0 8px}.title{font-size:13px}.subtitle{display:none}.zoom{gap:0;padding:1px}.zoom-button{min-width:26px;height:28px}.zoom-value{min-width:40px}.close{width:30px;padding:0}.workspace{grid-template-rows:minmax(0,1fr) 138px}aside{grid-template-columns:minmax(0,1fr) 104px;padding:8px}.layer{min-width:80px;padding:0 6px}.viewport{padding:8px}.actions{gap:5px}.button{font-size:11px}}
  `;
  const panel = document.createElement("main");
  panel.className = "panel";
  panel.setAttribute("aria-label", "Element composition editor");
  const header = document.createElement("header"),
    identity = document.createElement("div"),
    title = document.createElement("strong"),
    subtitle = document.createElement("span");
  identity.className = "identity";
  title.className = "title";
  title.textContent = "Element composition";
  subtitle.className = "subtitle";
  subtitle.textContent = "Drag to move · use the corner handle to resize";
  identity.append(title, subtitle);
  const zoom = document.createElement("div");
  zoom.className = "zoom";
  zoom.setAttribute("role", "group");
  zoom.setAttribute("aria-label", "Composition zoom");
  const zoomButton = (label: string, glyph: string, text?: string) => {
    const button = document.createElement("button");
    button.className = "button zoom-button";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    if (glyph) button.append(icon(glyph));
    if (text) button.textContent = text;
    return button;
  };
  const zoomOut = zoomButton("Zoom out (-)", "M5 12h14"),
    zoomValue = zoomButton("Fit whole composition (0)", "", "Fit"),
    zoomIn = zoomButton("Zoom in (+)", "M12 5v14M5 12h14");
  zoomValue.classList.add("zoom-value");
  zoom.append(zoomOut, zoomValue, zoomIn);
  const closeButton = document.createElement("button");
  closeButton.className = "button close";
  closeButton.type = "button";
  closeButton.title = "Close editor";
  closeButton.setAttribute("aria-label", "Close editor");
  closeButton.append(icon("M6 6l12 12M18 6 6 18"));
  header.append(identity, zoom, closeButton);

  const workspace = document.createElement("section");
  workspace.className = "workspace";
  const viewport = document.createElement("div");
  viewport.className = "viewport";
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", "Scrollable composition canvas");
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  const canvas = document.createElement("canvas");
  const padding = 48,
    gap = 28,
    maxSourceWidth = Math.max(...sources.map((source) => source.width)),
    canvasWidth = maxSourceWidth + padding * 2,
    canvasHeight = sources.reduce((sum, source) => sum + source.height, padding * 2) + gap * (sources.length - 1);
  if (canvasWidth * canvasHeight > 32_000_000 || Math.max(canvasWidth, canvasHeight) > 32767) {
    for (const bitmap of bitmaps) bitmap.close();
    showErrorPage("This composition exceeds the safe canvas size. Capture fewer or smaller elements.");
    return () => host.remove();
  }
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  canvas.setAttribute("aria-label", `Editable composition with ${sources.length} elements`);
  const items: PlacedItem[] = [];
  let y = padding;
  sources.forEach((source, index) => {
    items.push({
      source: index,
      x: (canvasWidth - source.width) / 2,
      y,
      width: source.width,
      height: source.height,
    });
    y += source.height + gap;
  });
  const layersPanel = document.createElement("aside"),
    layersTitle = document.createElement("h2"),
    layers = document.createElement("div"),
    inspector = document.createElement("div"),
    selectionLabel = document.createElement("div"),
    arrange = document.createElement("div");
  layersTitle.className = "aside-title";
  layersTitle.textContent = `Elements · ${items.length}`;
  layers.className = "layers";
  inspector.className = "inspector";
  selectionLabel.className = "selection-label";
  selectionLabel.textContent = "Select an element";
  arrange.className = "arrange";
  const makeButton = (label: string, glyph: string, primary = false) => {
    const button = document.createElement("button");
    button.className = `button${primary ? " primary" : ""}`;
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    if (glyph) button.append(icon(glyph));
    const text = document.createElement("span");
    text.textContent = label;
    button.append(text);
    return button;
  };
  const front = makeButton("Bring forward", "M12 19V5m-6 6 6-6 6 6"),
    back = makeButton("Send backward", "M12 5v14m-6-6 6 6 6-6"),
    remove = makeButton("Remove", "M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3");
  remove.classList.add("danger");
  arrange.append(front, back);
  inspector.append(selectionLabel, arrange, remove);
  layersPanel.append(layersTitle, layers, inspector);
  canvasWrap.append(canvas);
  viewport.append(canvasWrap);
  workspace.append(viewport, layersPanel);

  const footer = document.createElement("footer"),
    status = document.createElement("div"),
    actions = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Select an element to move, resize, or remove it. Undo and redo are available.";
  actions.className = "actions";
  const undo = makeButton("Undo", "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2"),
    redo = makeButton("Redo", "m15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2"),
    copy = makeButton("Copy composition", "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z", true),
    download = makeButton("Download PNG", "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4");
  actions.append(undo, redo, copy, download);
  footer.append(status, actions);
  panel.append(header, workspace, footer);
  root.append(style, panel);
  document.documentElement.append(host);

  let selected = -1,
    zoomScale = 1,
    fitMode: "whole" | "width" | "custom" = "width",
    gesture: { source: number; startX: number; startY: number; original: PlacedItem; resizing: boolean; changed: boolean } | undefined,
    disposed = false;
  const snapshotLayout = (): LayoutSnapshot => ({
    items: items.map((item) => ({ ...item })),
    selectedSource: items[selected]?.source ?? null,
  });
  const history: LayoutSnapshot[] = [snapshotLayout()];
  let historyIndex = 0;
  let annotationTool: AnnotationTool = "select";
  type EditDomain = "composition" | "annotation";
  const editHistory: EditDomain[] = [];
  let editHistoryIndex = 0;
  const canUndoEdit = () => editHistoryIndex > 0;
  const canRedoEdit = () => editHistoryIndex < editHistory.length;
  const recordEdit = (domain: EditDomain) => {
    editHistory.splice(editHistoryIndex);
    editHistory.push(domain);
    if (editHistory.length > 100) editHistory.shift();
    editHistoryIndex = editHistory.length;
  };
  let annotation: AnnotationAttachment | undefined;
  let undoLatest = () => {},
    redoLatest = () => {};
  const pushHistory = () => {
    history.splice(historyIndex + 1);
    history.push(snapshotLayout());
    if (history.length > 101) history.shift();
    historyIndex = history.length - 1;
    recordEdit("composition");
  };
  const syncLayers = () => {
    layers.replaceChildren();
    layersTitle.textContent = `Elements · ${items.length}`;
    items.forEach((item, order) => {
      const source = sources[item.source]!;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "layer";
      row.setAttribute("aria-pressed", String(order === selected));
      row.title = `Select ${source.label}, element ${order + 1}`;
      const number = document.createElement("span"),
        name = document.createElement("span");
      number.className = "layer-number";
      number.textContent = String(order + 1);
      name.className = "layer-name";
      name.textContent = `${source.label} · ${Math.round(item.width)} × ${Math.round(item.height)}`;
      row.append(number, name);
      row.addEventListener("click", () => {
        selected = order;
        status.textContent = `${source.label} selected. Drag to move; use its corner handle to resize.`;
        render();
      });
      layers.append(row);
    });
    selectionLabel.textContent = selected >= 0 && items[selected]
      ? `${sources[items[selected]!.source]!.label} · ${Math.round(items[selected]!.width)} × ${Math.round(items[selected]!.height)} px`
      : "Select an element";
    remove.disabled = selected < 0;
    front.disabled = selected < 0 || selected === items.length - 1;
    back.disabled = selected < 0 || selected === 0;
    copy.disabled = items.length === 0;
    download.disabled = items.length === 0;
  };
  const drawComposition = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, includeSelection: boolean) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    items.forEach((item, index) => {
      ctx.drawImage(bitmaps[item.source]!, item.x, item.y, item.width, item.height);
      if (includeSelection && index === selected) {
        const line = Math.max(2, canvas.width / 1200),
          handle = Math.max(12, canvas.width / 180);
        ctx.save();
        ctx.strokeStyle = "#2878e8";
        ctx.lineWidth = line;
        ctx.setLineDash([line * 3, line * 2]);
        ctx.strokeRect(item.x, item.y, item.width, item.height);
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#2878e8";
        ctx.fillRect(item.x + item.width - handle, item.y + item.height - handle, handle, handle);
        ctx.strokeRect(item.x + item.width - handle, item.y + item.height - handle, handle, handle);
        ctx.restore();
      }
    });
  };
  const drawSelection = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
    const item = items[selected];
    if (!item) return;
    const line = Math.max(2, canvas.width / 1200),
      handle = Math.max(12, canvas.width / 180);
    ctx.save();
    ctx.strokeStyle = "#2878e8";
    ctx.lineWidth = line;
    ctx.setLineDash([line * 3, line * 2]);
    ctx.strokeRect(item.x, item.y, item.width, item.height);
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#2878e8";
    ctx.fillRect(item.x + item.width - handle, item.y + item.height - handle, handle, handle);
    ctx.strokeRect(item.x + item.width - handle, item.y + item.height - handle, handle, handle);
    ctx.restore();
  };
  const render = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (annotation) annotation.render();
    else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawComposition(ctx, true);
    }
    undo.disabled = !canUndoEdit();
    redo.disabled = !canRedoEdit();
    syncLayers();
  };
  annotation = attachAnnotations(canvas, status, "", viewport, viewport, {
    drawBase: (context) => drawComposition(context, false),
    drawForeground: drawSelection,
    onToolChange: (tool) => { annotationTool = tool; },
    onUndo: () => undoLatest(),
    onRedo: () => redoLatest(),
    canUndo: canUndoEdit,
    canRedo: canRedoEdit,
    onHistoryCommit: () => recordEdit("annotation"),
  });
  const renderZoom = () => {
    canvas.style.width = `${Math.round(canvas.width * zoomScale)}px`;
    canvas.style.height = `${Math.round(canvas.height * zoomScale)}px`;
    zoomValue.textContent = `${Math.round(zoomScale * 100)}%`;
    zoomValue.setAttribute("aria-label", `Current zoom ${Math.round(zoomScale * 100)} percent. Fit whole composition.`);
  };
  const setZoom = (next: number) => {
    const rect = viewport.getBoundingClientRect(),
      old = canvas.getBoundingClientRect(),
      x = Math.max(0, Math.min(canvas.width, ((rect.left + viewport.clientWidth / 2 - old.left) * canvas.width) / Math.max(1, old.width))),
      y = Math.max(0, Math.min(canvas.height, ((rect.top + viewport.clientHeight / 2 - old.top) * canvas.height) / Math.max(1, old.height)));
    zoomScale = Math.max(0.05, Math.min(4, next));
    fitMode = "custom";
    renderZoom();
    const nextRect = canvas.getBoundingClientRect();
    viewport.scrollLeft = nextRect.left - rect.left + viewport.scrollLeft + x * zoomScale - viewport.clientWidth / 2;
    viewport.scrollTop = nextRect.top - rect.top + viewport.scrollTop + y * zoomScale - viewport.clientHeight / 2;
  };
  const fit = (mode: "whole" | "width") => {
    if (!viewport.clientWidth || !viewport.clientHeight) return;
    fitMode = mode;
    zoomScale = Math.min(1, viewport.clientWidth / canvas.width, mode === "whole" ? viewport.clientHeight / canvas.height : 1);
    renderZoom();
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  };
  const resizeObserver = new ResizeObserver(() => {
    if (fitMode === "whole" || fitMode === "width") fit(fitMode);
  });
  resizeObserver.observe(viewport);
  const handle = () => Math.max(14, canvas.width / 180);
  const point = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return clientToCanvasPoint(event.clientX, event.clientY, rect, canvas.width, canvas.height) ?? { x: 0, y: 0 };
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || annotationTool !== "select") return;
    const p = point(event);
    let hit = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      if (p.x >= item.x && p.x <= item.x + item.width && p.y >= item.y && p.y <= item.y + item.height) {
        hit = i;
        break;
      }
    }
    if (hit < 0) {
      selected = -1;
      render();
      return;
    }
    selected = hit;
    const item = items[hit]!;
    gesture = {
      source: item.source,
      startX: p.x,
      startY: p.y,
      original: { ...item },
      resizing: p.x >= item.x + item.width - handle() && p.y >= item.y + item.height - handle(),
      changed: false,
    };
    canvas.setPointerCapture(event.pointerId);
    render();
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!gesture) return;
    const p = point(event),
      dx = p.x - gesture.startX,
      dy = p.y - gesture.startY,
      item = items.find((candidate) => candidate.source === gesture!.source);
    if (!item) return;
    if (gesture.resizing) {
      const source = sources[item.source]!,
        aspect = source.width / source.height,
        maxWidth = Math.min(canvas.width - item.x, (canvas.height - item.y) * aspect),
        width = resizedAspectWidth(gesture.original.width, aspect, dx, dy, maxWidth);
      item.width = width;
      item.height = width / aspect;
    } else {
      item.x = Math.max(0, Math.min(canvas.width - item.width, gesture.original.x + dx));
      item.y = Math.max(0, Math.min(canvas.height - item.height, gesture.original.y + dy));
    }
    gesture.changed = gesture.changed || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    status.textContent = gesture.resizing ? "Resizing selected element" : "Moving selected element";
    render();
  });
  const finishGesture = () => {
    if (!gesture) return;
    if (gesture.changed) {
      pushHistory();
      status.textContent = gesture.resizing ? "Element resized" : "Element moved";
    }
    gesture = undefined;
    render();
  };
  canvas.addEventListener("pointerup", finishGesture);
  canvas.addEventListener("pointercancel", () => {
    if (!gesture) return;
    const item = items.find((candidate) => candidate.source === gesture!.source);
    if (item) Object.assign(item, gesture.original);
    gesture = undefined;
    status.textContent = "Change canceled";
    render();
  });
  const removeSelected = () => {
    if (selected < 0) return;
    items.splice(selected, 1);
    selected = Math.min(selected, items.length - 1);
    pushHistory();
    status.textContent = "Element removed. Undo to restore it.";
    render();
  };
  const moveLayer = (direction: -1 | 1) => {
    if (selected < 0) return;
    const target = selected + direction;
    if (target < 0 || target >= items.length) return;
    const [item] = items.splice(selected, 1);
    items.splice(target, 0, item!);
    selected = target;
    pushHistory();
    render();
    status.textContent = direction > 0 ? "Element brought forward" : "Element sent backward";
  };
  const undoAction = () => {
    if (historyIndex <= 0) return;
    historyIndex--;
    const snapshot = history[historyIndex]!;
    items.splice(0, items.length, ...snapshot.items.map((item) => ({ ...item })));
    selected = snapshot.selectedSource === null ? -1 : items.findIndex((item) => item.source === snapshot.selectedSource);
    status.textContent = "Undid last change";
    render();
  };
  const redoAction = () => {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    const snapshot = history[historyIndex]!;
    items.splice(0, items.length, ...snapshot.items.map((item) => ({ ...item })));
    selected = snapshot.selectedSource === null ? -1 : items.findIndex((item) => item.source === snapshot.selectedSource);
    status.textContent = "Redid change";
    render();
  };
  undoLatest = () => {
    if (!canUndoEdit()) return;
    const domain = editHistory[--editHistoryIndex]!;
    if (domain === "annotation") annotation?.undo();
    else undoAction();
    render();
  };
  redoLatest = () => {
    if (!canRedoEdit()) return;
    const domain = editHistory[editHistoryIndex++]!;
    if (domain === "annotation") annotation?.redo();
    else redoAction();
    render();
  };
  const exportBlob = async () => {
    if (!items.length) throw new Error("Add an element before exporting.");
    const output = new OffscreenCanvas(canvas.width, canvas.height),
      context = output.getContext("2d");
    if (!context) throw new Error("Could not prepare the composition image.");
    annotation?.renderForExport(context);
    const blob = await output.convertToBlob({ type: "image/png" });
    output.width = output.height = 1;
    return blob;
  };
  const copyImage = async () => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Clipboard image support is unavailable. Download the PNG instead.");
      const blob = await exportBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      status.textContent = "Composition copied to clipboard";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Copy failed. Try downloading the PNG.";
    }
  };
  const downloadImage = async () => {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(await exportBlob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `precision-composition-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      anchor.click();
      status.textContent = "PNG download started";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Download failed.";
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 10_000);
    }
  };
  const closeEditor = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("keydown", keydown, true);
    resizeObserver.disconnect();
    annotation?.();
    annotation = undefined;
    for (const bitmap of bitmaps) bitmap.close();
    host.remove();
    close();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoLatest();
        else undoLatest();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoLatest();
      }
      return;
    }
    if (event.altKey || event.target instanceof HTMLInputElement) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeEditor();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
    } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && selected >= 0) {
      event.preventDefault();
      const item = items[selected]!,
        amount = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowUp") item.y = Math.max(0, item.y - amount);
      if (event.key === "ArrowDown") item.y = Math.min(canvas.height - item.height, item.y + amount);
      if (event.key === "ArrowLeft") item.x = Math.max(0, item.x - amount);
      if (event.key === "ArrowRight") item.x = Math.min(canvas.width - item.width, item.x + amount);
      pushHistory();
      render();
    } else if (event.key === "+" || event.key === "=") setZoom(zoomScale * 1.25);
    else if (event.key === "-") setZoom(zoomScale / 1.25);
    else if (event.key === "0") fit("whole");
    else if (event.key === "]") moveLayer(1);
    else if (event.key === "[") moveLayer(-1);
  };
  document.addEventListener("keydown", keydown, true);
  closeButton.addEventListener("click", closeEditor);
  front.addEventListener("click", () => moveLayer(1));
  back.addEventListener("click", () => moveLayer(-1));
  remove.addEventListener("click", removeSelected);
  undo.addEventListener("click", undoLatest);
  redo.addEventListener("click", redoLatest);
  zoomOut.addEventListener("click", () => setZoom(zoomScale / 1.25));
  zoomIn.addEventListener("click", () => setZoom(zoomScale * 1.25));
  zoomValue.addEventListener("click", () => fit("whole"));
  copy.addEventListener("click", () => void copyImage());
  download.addEventListener("click", () => void downloadImage());
  render();
  requestAnimationFrame(() => fit("width"));
  closeButton.focus({ preventScroll: true });
  return closeEditor;

  function showErrorPage(message: string) {
    const screen = document.createElement("div"),
      title = document.createElement("h1"),
      body = document.createElement("p"),
      dismiss = document.createElement("button");
    screen.style.cssText = "position:fixed;inset:20px;z-index:2;display:grid;place-content:center;gap:10px;background:#f7f7f5;color:#202124;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif";
    title.textContent = "Composition is too large";
    body.textContent = message;
    dismiss.textContent = "Close editor";
    dismiss.addEventListener("click", close);
    screen.append(title, body, dismiss);
    root.replaceChildren(style, screen);
    document.documentElement.append(host);
  }
}
