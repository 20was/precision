import type { Rect } from "./shared/geometry";
import { attachAnnotations } from "./annotation";

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(svg.namespaceURI, "path");
  line.setAttribute("d", path);
  svg.append(line);
  return svg;
}
export class Overlay {
  readonly host = document.createElement("precision-selector");
  private readonly root = this.host.attachShadow({ mode: "closed" });
  private readonly box = document.createElement("div");
  private readonly label = document.createElement("div");
  private readonly toolbar = document.createElement("div");
  private readonly copyButton = document.createElement("button");
  private readonly previewButton = document.createElement("button");
  private readonly undoAddButton = document.createElement("button");
  private readonly copyLabel = document.createElement("span");
  private readonly composition: boolean;
  private toolbarBounds = { left: 0, right: 0, top: 0, bottom: 0 };
  private selectionRect: Rect | null = null;
  constructor(actions: {
    cancel: () => void;
    preview: () => void;
    copy: () => void;
    undoAdd?: () => void;
  }, mode: "element" | "compose" = "element") {
    this.composition = mode === "compose";
    this.host.tabIndex = -1;
    this.host.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:auto!important;display:block!important;outline:none!important;cursor:crosshair!important;";
    const style = document.createElement("style");
    style.textContent = `
      :host{color-scheme:dark}*{box-sizing:border-box}
      .box{position:fixed;border:1px solid #fff;outline:1px solid #20201e;box-shadow:inset 0 0 0 1px #20201e;display:none}
      .label{position:fixed;background:#242421;color:#f5f4ef;border:1px solid #55554e;border-radius:3px;padding:4px 7px;font:500 11px/16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;max-width:calc(100vw - 16px);overflow:hidden;text-overflow:ellipsis}
      .toolbar{position:fixed;left:0;top:0;display:flex;align-items:center;gap:4px;padding:4px;background:#242421;color:#f5f4ef;border:1px solid #55554e;border-radius:8px;box-shadow:0 4px 20px #0003;font:12px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:default;max-width:calc(100vw - 16px)}
      .copy{background:#f5f4ef;color:#242421;padding:7px 10px;font-weight:600;white-space:nowrap}.copy:hover{background:#deddd6}.copy:disabled{opacity:.7}
      svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;flex:none}
      button{display:flex;align-items:center;justify-content:center;gap:7px;color:#f5f4ef;background:transparent;border:0;border-radius:4px;padding:6px;font:inherit;cursor:pointer}button:hover{background:#41413b}button:focus-visible{outline:2px solid #f5f4ef;outline-offset:2px}:host(:focus-visible) .toolbar{outline:2px solid #f5f4ef;outline-offset:3px}button:disabled{opacity:.3;cursor:default}kbd{font:10px/16px -apple-system,BlinkMacSystemFont,sans-serif;border:1px solid #66665c;border-radius:3px;padding:0 4px;color:#d6d5cc}
      @media(max-width:620px){.toolbar{gap:2px;padding:3px}}
    `;
    this.box.className = "box";
    this.label.className = "label";
    this.toolbar.className = "toolbar";
    this.label.setAttribute("role", "status");
    this.label.setAttribute("aria-live", "polite");
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", this.composition ? "Compose selected page elements" : "Element selection");
    this.copyButton.type = "button";
    this.copyButton.className = "copy";
    this.copyButton.setAttribute("aria-label", this.composition ? "Add selected element to composition" : "Copy selected element");
    this.copyButton.title = this.composition ? "Add this visible element and keep selecting" : "Capture and copy without opening the preview";
    this.copyLabel.textContent = this.composition ? "Add element" : "Copy";
    this.copyButton.append(
      icon(
        "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z",
      ),
      this.copyLabel,
    );
    this.copyButton.addEventListener("click", actions.copy);
    this.previewButton.type = "button";
    this.previewButton.textContent = this.composition ? "Compose · 0" : "Preview";
    this.previewButton.disabled = this.composition;
    this.previewButton.setAttribute("aria-label", this.composition ? "Compose captured elements" : "Preview selected element");
    this.previewButton.title = this.composition ? "Capture at least one element to compose" : "Open image preview (Enter)";
    this.previewButton.addEventListener("click", actions.preview);
    this.undoAddButton.type = "button";
    this.undoAddButton.textContent = "Undo add";
    this.undoAddButton.setAttribute("aria-label", "Remove the last added element");
    this.undoAddButton.title = "Remove the last added element";
    this.undoAddButton.disabled = true;
    this.undoAddButton.addEventListener("click", () => actions.undoAdd?.());
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Esc";
    cancel.setAttribute("aria-label", "Cancel selection");
    cancel.title = "Cancel selection (Escape)";
    cancel.addEventListener("click", actions.cancel);
    if (this.composition) this.toolbar.append(this.copyButton, this.undoAddButton, this.previewButton, cancel);
    else this.toolbar.append(this.copyButton, this.previewButton, cancel);
    this.root.append(style, this.box, this.label, this.toolbar);
    document.documentElement.append(this.host);
    this.toolbar.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = [...this.toolbar.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (!controls.length) return;
      const focused = this.root.activeElement as HTMLButtonElement | null;
      if (event.shiftKey && focused === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && focused === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    });
    this.focusSelection();
  }
  focusSelection() {
    this.host.focus({ preventScroll: true });
  }
  show(rect: Rect | null, name = "", x?: number, y?: number) {
    this.host.style.setProperty("display", "block", "important");
    this.box.style.display = rect ? "block" : "none";
    this.label.style.display = rect ? "block" : "none";
    this.selectionRect = rect;
    if (!rect) return;
    Object.assign(this.box.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    this.label.textContent = `${name} / visible area`;
    this.label.style.left = `${Math.max(8, Math.min(rect.x, innerWidth - 200))}px`;
    this.label.style.top = `${rect.y >= 34 ? rect.y - 29 : Math.min(innerHeight - 34, rect.y + rect.height + 5)}px`;
    if (x !== undefined && y !== undefined) {
      const toolbar = this.toolbar.getBoundingClientRect();
      const copy = this.copyButton.getBoundingClientRect();
      const centeredLeft = Math.max(
        4,
        Math.min(
          innerWidth - toolbar.width - 4,
          x - (copy.left - toolbar.left + copy.width / 2),
        ),
      );
      const centeredTop = Math.max(
        4,
        Math.min(
          innerHeight - toolbar.height - 4,
          y - (copy.top - toolbar.top + copy.height / 2),
        ),
      );
      const clamp = (v: number, max: number, size: number) =>
        Math.max(4, Math.min(max - size - 4, v));
      const intersects = (
        a: { left: number; top: number; right: number; bottom: number },
        b: Rect,
      ) =>
        a.left < b.x + b.width &&
        a.right > b.x &&
        a.top < b.y + b.height &&
        a.bottom > b.y;
      const candidates = [
        {
          left: rect.x + rect.width,
          top: clamp(y - toolbar.height / 2, innerHeight, toolbar.height),
        },
        {
          left: rect.x - toolbar.width,
          top: clamp(y - toolbar.height / 2, innerHeight, toolbar.height),
        },
        {
          left: clamp(
            x - (copy.left - toolbar.left + copy.width / 2),
            innerWidth,
            toolbar.width,
          ),
          top: rect.y + rect.height,
        },
        {
          left: clamp(
            x - (copy.left - toolbar.left + copy.width / 2),
            innerWidth,
            toolbar.width,
          ),
          top: rect.y - toolbar.height,
        },
      ].filter(
        (p) =>
          p.left >= 4 &&
          p.top >= 4 &&
          p.left + toolbar.width <= innerWidth - 4 &&
          p.top + toolbar.height <= innerHeight - 4 &&
          !intersects(
            {
              left: p.left,
              top: p.top,
              right: p.left + toolbar.width,
              bottom: p.top + toolbar.height,
            },
            rect,
          ),
      );
      const score = (p: { left: number; top: number }) => {
        const dx =
          x < p.left
            ? p.left - x
            : x > p.left + toolbar.width
              ? x - (p.left + toolbar.width)
              : 0;
        const dy =
          y < p.top
            ? p.top - y
            : y > p.top + toolbar.height
              ? y - (p.top + toolbar.height)
              : 0;
        return dx * dx + dy * dy;
      };
      const adjacent = candidates.sort((a, b) => score(a) - score(b))[0];
      const left = adjacent?.left ?? centeredLeft;
      const top = adjacent?.top ?? centeredTop;
      this.toolbar.style.left = `${left}px`;
      this.toolbar.style.top = `${top}px`;
      const placed = this.toolbar.getBoundingClientRect();
      this.toolbarBounds = {
        left: placed.left,
        right: placed.right,
        top: placed.top,
        bottom: placed.bottom,
      };
    }
  }
  setCopyBusy(busy: boolean) {
    this.copyButton.disabled = busy;
    this.copyLabel.textContent = busy ? (this.composition ? "Adding…" : "Copying…") : (this.composition ? "Add element" : "Copy");
  }
  setCompositionCount(count: number) {
    if (!this.composition) return;
    this.previewButton.textContent = `Compose · ${count}`;
    this.previewButton.disabled = count === 0;
    this.previewButton.title = count ? "Open the editable composition canvas" : "Capture at least one element to compose";
    this.previewButton.setAttribute("aria-label", `Compose ${count} captured element${count === 1 ? "" : "s"}`);
    this.undoAddButton.disabled = count === 0;
  }
  setMessage(message: string) {
    this.label.textContent = message;
    this.label.style.display = "block";
  }
  isToolbarPoint(x: number, y: number) {
    const r = this.toolbarBounds;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  isToolbarReachPoint(x: number, y: number) {
    const r = this.toolbarBounds;
    const pad = 6;
    return (
      x >= r.left - pad &&
      x <= r.right + pad &&
      y >= r.top - pad &&
      y <= r.bottom + pad
    );
  }
  isControlFocused() {
    return this.root.activeElement instanceof HTMLButtonElement;
  }
  hitTest<T>(read: () => T): T {
    this.host.style.setProperty("pointer-events", "none", "important");
    try {
      return read();
    } finally {
      this.host.style.setProperty("pointer-events", "auto", "important");
    }
  }
  hide() {
    this.host.style.setProperty("display", "none", "important");
  }
  remove() {
    this.host.remove();
  }
}
export function showError(message: string) {
  const host = document.createElement("precision-error");
  host.style.cssText =
    "all:initial!important;position:fixed!important;bottom:16px!important;left:16px!important;z-index:2147483647!important;";
  const root = host.attachShadow({ mode: "closed" }),
    box = document.createElement("div"),
    button = document.createElement("button");
  box.style.cssText =
    "font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;background:#242421;color:#f5f4ef;padding:14px;border:1px solid #66665c;border-radius:6px;max-width:360px";
  box.setAttribute("role", "alert");
  box.textContent = message + " ";
  button.textContent = "Dismiss";
  button.style.cssText =
    "font:inherit;color:#f5f4ef;background:transparent;border:1px solid #66665c;border-radius:4px;padding:4px 8px";
  const remove = () => {
    host.remove();
    clearTimeout(timer);
  };
  button.addEventListener("click", remove);
  box.append(button);
  root.append(box);
  document.documentElement.append(host);
  const timer = setTimeout(remove, 10_000);
}

export function showNotice(message: string) {
  const host = document.createElement("precision-notice");
  host.style.cssText =
    "all:initial!important;position:fixed!important;bottom:20px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483647!important;pointer-events:none!important;";
  const root = host.attachShadow({ mode: "closed" }),
    notice = document.createElement("div");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.textContent = message;
  notice.style.cssText =
    "font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;background:#242421;color:#f5f4ef;border:1px solid #55554e;border-radius:5px;padding:9px 13px;box-shadow:0 3px 14px #0002;white-space:nowrap";
  root.append(notice);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 2400);
}

export function showPreview(
  png: string,
  width: number,
  height: number,
  close: () => void,
): () => void {
  const previouslyFocused = document.activeElement;
  const host = document.createElement("precision-preview");
  host.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:auto!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box}
    .backdrop{position:fixed;inset:0;background:rgba(13,15,18,.42);backdrop-filter:blur(2px)}
    .panel{position:absolute;inset:24px;margin:auto;width:min(1500px,calc(100vw - 48px));height:min(1000px,calc(100vh - 48px));display:grid;grid-template-rows:64px minmax(0,1fr) auto;background:#f7f7f5;color:#202124;border:1px solid #d9dadd;border-radius:16px;box-shadow:0 28px 90px rgba(0,0,0,.28);overflow:hidden;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 22px;border-bottom:1px solid #e5e5e3;background:#fff}
    .identity{display:flex;align-items:baseline;gap:14px;min-width:0}.title{font-size:15px;font-weight:650;letter-spacing:-.2px}.meta{color:#73757a;font-size:12px;font-variant-numeric:tabular-nums}
    .zoom-controls{display:flex;align-items:center;gap:3px;margin-left:auto;padding:3px;background:#f3f3f1;border:1px solid #e5e5e3;border-radius:8px;flex:none}
    .zoom-button{display:grid;place-items:center;min-width:30px;height:30px;padding:0 7px;color:#45474b;background:transparent;border:1px solid transparent;border-radius:5px;font:500 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}
    .zoom-button:hover{background:#e8e9e9}.zoom-button:disabled{opacity:.4;cursor:default}.zoom-value{min-width:48px}
    .zoom-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
    .stage{position:relative;min-width:0;min-height:0;overflow:hidden;display:grid;grid-template-columns:58px minmax(0,1fr);grid-template-rows:minmax(0,1fr);align-items:stretch;background:#f0f0ee;padding:20px}
    .image-viewport{grid-column:2;grid-row:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-color:#a9aaad transparent;scrollbar-width:thin}
    .canvas-wrap{width:max-content;height:max-content;min-width:100%;min-height:100%;display:grid;place-items:center}
    canvas{display:block;min-width:0;min-height:0;max-width:none;max-height:none;width:auto;height:auto;object-fit:contain;background:#fff;border:1px solid rgba(0,0,0,.1);box-shadow:0 8px 28px rgba(0,0,0,.12);touch-action:none}
    .annotation-tools{grid-column:1;grid-row:1;z-index:2;align-self:center;display:flex;flex-direction:column;align-items:center;gap:5px;width:46px;max-height:100%;overflow-y:auto;scrollbar-width:thin;padding:6px;background:#fff;border:1px solid #dedfdf;border-radius:12px;box-shadow:0 3px 12px rgba(0,0,0,.08)}
    .annotation-list{position:absolute;z-index:3;top:8px;right:8px;max-width:min(260px,calc(100% - 72px));max-height:50%;overflow:auto;padding:6px 9px;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:8px;box-shadow:0 3px 14px #0002;font-size:12px;pointer-events:none}.annotation-list summary,.annotation-list button{pointer-events:auto}.annotation-list summary{cursor:pointer;font-weight:600}.annotation-list ul{display:grid;gap:4px;max-height:180px;overflow:auto;margin:6px 0 0;padding:0;list-style:none}.annotation-list button{max-width:100%;padding:5px 7px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:5px;background:Canvas;color:CanvasText;text-align:left;font:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.annotation-list button[aria-pressed=true]{outline:2px solid #4b83e6}
    button{font:inherit;border:0;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,transform .12s ease}
    .tool-button,.close-button{display:grid;place-items:center;width:34px;height:34px;padding:0;color:#45474b;background:transparent;border:1px solid transparent;border-radius:8px}
    .tool-button svg,.close-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .tool-button:hover,.close-button:hover{background:#f1f2f3;color:#191a1c}
    .tool-button[aria-pressed=true]{color:#1459c7;background:#eaf1ff;border-color:#d5e3ff}
    .tool-button:disabled{opacity:.38;cursor:default}
    .tool-divider{width:24px;height:1px;background:#e4e5e6;margin:2px 0}
    .annotation-tools input[type=color]{width:25px;height:25px;padding:2px;border:1px solid #d4d5d7;border-radius:50%;background:#fff;cursor:pointer;overflow:hidden}
    .canvas-text-input{position:absolute;z-index:4;min-width:1em;height:auto;padding:0;border:0;border-radius:0;background:transparent;color:inherit;box-shadow:none;outline:0;font:600 14px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;caret-color:currentColor;text-shadow:0 1px 2px rgba(0,0,0,.35)}
    .footer{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;padding:14px 20px;border-top:1px solid #e3e4e5;background:#fff}
    .status{min-height:18px;color:#777a80;font-size:12px}.actions{display:flex;align-items:center;gap:8px}
    .action-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 14px;color:#313338;background:#fff;border:1px solid #d5d6d8;border-radius:8px;font-size:13px;font-weight:560}
    .action-button:hover{background:#f5f6f7;border-color:#b9bbbf}.action-button:active,.tool-button:active{transform:translateY(1px)}
    .action-button.primary{color:#fff;background:#1f2937;border-color:#1f2937}.action-button.primary:hover{background:#111827;border-color:#111827}
    .action-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    button:focus-visible,input:focus-visible{outline:2px solid #4b83e6;outline-offset:2px}
    @media(prefers-color-scheme:dark){.panel{background:#202124;color:#f1f3f4;border-color:#3b3d40}.head,.footer{background:#252629;border-color:#3b3d40}.stage{background:#1b1c1e}.meta,.status{color:#aeb0b5}.zoom-controls{background:#292b2e;border-color:#414348}.zoom-button{color:#d1d3d7}.zoom-button:hover{background:#383a3e}.annotation-tools{background:#292b2e;border-color:#414348;box-shadow:0 3px 14px #0006}.tool-button,.close-button{color:#d1d3d7}.tool-button:hover,.close-button:hover{background:#383a3e;color:#fff}.tool-button[aria-pressed=true]{color:#a9c7ff;background:#253a5f;border-color:#365681}.tool-divider{background:#484a4e}.annotation-tools input[type=color]{background:#292b2e;border-color:#55585d}.canvas-text-input{color:#f1f3f4;text-shadow:0 1px 2px rgba(0,0,0,.65)}.action-button{color:#e1e3e6;background:#292b2e;border-color:#4a4c50}.action-button:hover{background:#35373b;border-color:#65676d}.action-button.primary{color:#202124;background:#e8eaed;border-color:#e8eaed}.action-button.primary:hover{background:#fff}}
    @media(max-width:700px){.panel{inset:8px;width:calc(100vw - 16px);height:calc(100vh - 16px);grid-template-rows:56px minmax(0,1fr) auto;border-radius:12px}.head{padding:0 14px;gap:8px}.stage{grid-template-columns:48px minmax(0,1fr);padding:10px}.annotation-tools{width:40px;padding:4px;gap:3px}.tool-button{width:30px;height:30px}.tool-button svg{width:16px;height:16px}.footer{grid-template-columns:1fr;gap:8px;padding:10px 12px}.actions{justify-content:flex-end}.action-button{height:36px;padding:0 10px}.identity{gap:8px}.title{font-size:14px}.zoom-controls{gap:0;padding:2px}.zoom-button{min-width:28px;height:28px}}
    @media(max-width:420px){.meta{display:none}.action-button{font-size:12px}.actions{gap:5px}.panel{grid-template-rows:50px minmax(0,1fr) auto}.head{gap:5px}.stage{grid-template-columns:42px minmax(0,1fr);padding:7px}.annotation-tools{width:36px}.tool-button{width:28px;height:28px}.zoom-button{min-width:25px;padding:0 4px}.zoom-value{min-width:42px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
  `;
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Screenshot editor");
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const head = document.createElement("div");
  head.className = "head";
  const identity = document.createElement("div");
  identity.className = "identity";
  const heading = document.createElement("span");
  heading.className = "title";
  heading.textContent = "Screenshot editor";
  const dimensions = document.createElement("span");
  dimensions.className = "meta";
  dimensions.textContent = `${width} × ${height} px`;
  identity.append(heading, dimensions);
  const zoomControls = document.createElement("div");
  zoomControls.className = "zoom-controls";
  zoomControls.setAttribute("role", "group");
  zoomControls.setAttribute("aria-label", "Image zoom controls");
  const zoomButton = (label: string, path: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zoom-button";
    button.setAttribute("aria-label", label);
    button.title = label;
    if (path) button.append(icon(path));
    return button;
  };
  const zoomOut = zoomButton("Zoom out (−)", "M5 12h14"),
    zoomValue = zoomButton("Fit image to view", ""),
    zoomIn = zoomButton("Zoom in (+)", "M12 5v14M5 12h14");
  zoomValue.classList.add("zoom-value");
  zoomValue.textContent = "Fit";
  zoomControls.append(zoomOut, zoomValue, zoomIn);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close-button";
  closeButton.title = "Close editor";
  closeButton.setAttribute("aria-label", "Close editor");
  closeButton.append(icon("M6 6l12 12M18 6 6 18"));
  head.append(identity, zoomControls, closeButton);
  const stage = document.createElement("div");
  stage.className = "stage";
  const imageViewport = document.createElement("div");
  imageViewport.className = "image-viewport";
  imageViewport.setAttribute("role", "region");
  imageViewport.setAttribute("aria-label", "Scrollable screenshot preview");
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute(
    "aria-label",
    `Captured image, ${width} by ${height} pixels`,
  );
  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent =
    "Choose a tool, then annotate directly on the screenshot.";
  const actions = document.createElement("div");
  actions.className = "actions";
  const footer = document.createElement("div");
  footer.className = "footer";
  const button = (label: string, glyph: string, primary = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `action-button${primary ? " primary" : ""}`;
    b.textContent = label;
    b.setAttribute("aria-label", label);
    b.insertBefore(icon(glyph), b.firstChild);
    return b;
  };
  const copy = button(
      "Copy image",
      "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z",
      true,
    ),
    download = button("Download PNG", "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4");
  actions.append(copy, download);
  canvasWrap.append(canvas);
  imageViewport.append(canvasWrap);
  stage.append(imageViewport);
  footer.append(status, actions);
  panel.append(head, stage, footer);
  root.append(style, backdrop, panel);
  document.documentElement.append(host);
  let zoom = 1,
    fitMode: "whole" | "width" | "custom" = "whole";
  const MIN_ZOOM = 0.05,
    MAX_ZOOM = 4;
  const renderZoom = () => {
    canvas.style.width = `${Math.round(width * zoom)}px`;
    canvas.style.height = `${Math.round(height * zoom)}px`;
    zoomOut.disabled = zoom <= MIN_ZOOM;
    zoomIn.disabled = zoom >= MAX_ZOOM;
    zoomValue.textContent = `${Math.round(zoom * 100)}%`;
    zoomValue.title = "Fit entire image to view (0)";
    zoomValue.setAttribute(
      "aria-label",
      `Current zoom ${Math.round(zoom * 100)} percent. Fit entire image to view.`,
    );
  };
  const zoomTo = (next: number) => {
    const viewportRect = imageViewport.getBoundingClientRect(),
      canvasRect = canvas.getBoundingClientRect(),
      anchorX = Math.max(
        0,
        Math.min(
          width,
          ((viewportRect.left + imageViewport.clientWidth / 2 - canvasRect.left) * width) /
            Math.max(1, canvasRect.width),
        ),
      ),
      anchorY = Math.max(
        0,
        Math.min(
          height,
          ((viewportRect.top + imageViewport.clientHeight / 2 - canvasRect.top) * height) /
            Math.max(1, canvasRect.height),
        ),
      );
    fitMode = "custom";
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    renderZoom();
    const nextRect = canvas.getBoundingClientRect();
    imageViewport.scrollLeft =
      nextRect.left - viewportRect.left + imageViewport.scrollLeft +
      anchorX * zoom - imageViewport.clientWidth / 2;
    imageViewport.scrollTop =
      nextRect.top - viewportRect.top + imageViewport.scrollTop +
      anchorY * zoom - imageViewport.clientHeight / 2;
  };
  const fitImage = () => {
    if (!imageViewport.clientWidth || !imageViewport.clientHeight) return;
    fitMode = "whole";
    zoom = Math.min(
      1,
      imageViewport.clientWidth / width,
      imageViewport.clientHeight / height,
    );
    renderZoom();
    imageViewport.scrollLeft = 0;
    imageViewport.scrollTop = 0;
  };
  const fitWidth = () => {
    if (!imageViewport.clientWidth) return;
    fitMode = "width";
    zoom = Math.min(1, imageViewport.clientWidth / width);
    renderZoom();
    imageViewport.scrollLeft = 0;
    imageViewport.scrollTop = 0;
  };
  const zoomObserver = new ResizeObserver(() => {
    if (fitMode === "whole") fitImage();
    else if (fitMode === "width") fitWidth();
  });
  zoomObserver.observe(imageViewport);
  zoomOut.addEventListener("click", () => zoomTo(zoom / 1.25));
  zoomIn.addEventListener("click", () => zoomTo(zoom * 1.25));
  zoomValue.addEventListener("click", fitImage);
  requestAnimationFrame(() => (height / width > 1.4 ? fitWidth() : fitImage()));
  const blobUrls: string[] = [];
  let removed = false;
  let disposeAnnotations = () => {};
  const dispose = () => {
    if (removed) return;
    removed = true;
    document.removeEventListener("keydown", keydown, true);
    zoomObserver.disconnect();
    disposeAnnotations();
    for (const blobUrl of blobUrls) URL.revokeObjectURL(blobUrl);
    blobUrls.length = 0;
    host.remove();
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected)
      previouslyFocused.focus({ preventScroll: true });
    close();
  };
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...root.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])")];
    if (!controls.length) return;
    const focused = root.activeElement as HTMLElement | null;
    if (event.shiftKey && (focused === controls[0] || !controls.includes(focused!))) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && (focused === controls.at(-1) || !controls.includes(focused!))) {
      event.preventDefault();
      controls[0]?.focus();
    }
  });
  const keydown = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      dispose();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(zoom * 1.25);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomTo(zoom / 1.25);
    } else if (event.key === "0") {
      event.preventDefault();
      fitImage();
    }
  };
  document.addEventListener("keydown", keydown, true);
  closeButton.addEventListener("click", dispose);
  backdrop.addEventListener("click", dispose);
  const canvasBlob = () =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("PNG export failed.")),
        "image/png",
      ),
    );
  copy.addEventListener("click", () => {
    void (async () => {
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
          throw new Error(
            "Clipboard image support is unavailable. Download the PNG instead.",
          );
        const blob = await canvasBlob();
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        status.textContent = "Copied to clipboard";
      } catch (error) {
        status.textContent =
          error instanceof Error
            ? error.message
            : "Copy was blocked. Try again or download the PNG.";
      }
    })();
  });
  download.addEventListener("click", () => {
    void (async () => {
      try {
        const blobUrl = URL.createObjectURL(await canvasBlob());
        blobUrls.push(blobUrl);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `precision-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.png`;
        a.click();
        status.textContent = "PNG download started";
      } catch {
        status.textContent = "Download failed. Try copying the image instead.";
      }
    })();
  });
  disposeAnnotations = attachAnnotations(canvas, status, png, stage, stage);
  copy.focus({ preventScroll: true });
  return dispose;
}
