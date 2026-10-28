import type { Rect } from "./shared/geometry";
import type { RectCorner } from "./shared/geometry";
import { attachAnnotations, type AnnotationAttachment } from "./annotation";
import { captureTimeMetrics, clipWindowContent, displaySourceUrl, drawWindowFrame, formatCaptureTime, frameDimensions, type WindowFrameStyle } from "./shared/window-frame";
import { createFrameControls } from "./shared/frame-controls";

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
  private readonly regionHandles = new Map<RectCorner, HTMLButtonElement>();
  private readonly copyButton = document.createElement("button");
  private readonly previewButton = document.createElement("button");
  private readonly undoAddButton = document.createElement("button");
  private readonly copyLabel = document.createElement("span");
  private readonly composition: boolean;
  private readonly region: boolean;
  private toolbarBounds = { left: 0, right: 0, top: 0, bottom: 0 };
  private selectionRect: Rect | null = null;
  constructor(actions: {
    cancel: () => void;
    preview: () => void;
    copy: () => void;
    undoAdd?: () => void;
  }, mode: "element" | "compose" | "region" = "element") {
    this.composition = mode === "compose";
    this.region = mode === "region";
    this.host.tabIndex = -1;
    this.host.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:auto!important;display:block!important;outline:none!important;cursor:crosshair!important;";
    const style = document.createElement("style");
    style.textContent = `
      :host{color-scheme:dark}*{box-sizing:border-box}
      .box{position:fixed;border:1px solid #fff;outline:1px solid #20201e;box-shadow:inset 0 0 0 1px #20201e;display:none}
      .label{position:fixed;background:#242421;color:#f5f4ef;border:1px solid #55554e;border-radius:3px;padding:4px 7px;font:500 11px/16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap;max-width:calc(100vw - 16px);overflow:hidden;text-overflow:ellipsis}
      .toolbar{position:fixed;left:0;top:0;display:flex;align-items:center;gap:4px;padding:4px;background:#242421;color:#f5f4ef;border:1px solid #55554e;border-radius:8px;box-shadow:0 4px 20px #0003;font:12px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:default;max-width:calc(100vw - 16px)}
      .resize-handle{position:fixed;z-index:1;width:18px;height:18px;padding:0;border:2px solid #242421;border-radius:4px;background:#f5f4ef;box-shadow:0 0 0 1px #fff;transform:translate(-50%,-50%);cursor:pointer;touch-action:none}
      .resize-handle[data-corner="nw"],.resize-handle[data-corner="se"]{cursor:nwse-resize}.resize-handle[data-corner="ne"],.resize-handle[data-corner="sw"]{cursor:nesw-resize}
      .resize-handle[hidden]{display:none}
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
    this.toolbar.setAttribute("aria-label", this.composition ? "Compose selected page elements" : this.region ? "Selected page region" : "Element selection");
    this.copyButton.type = "button";
    this.copyButton.className = "copy";
    this.copyButton.setAttribute("aria-label", this.composition ? "Add selected element to composition" : this.region ? "Copy selected region" : "Copy selected element");
    this.copyButton.title = this.composition ? "Add this visible element and keep selecting" : this.region ? "Capture and copy this area" : "Capture and copy without opening the preview";
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
    this.previewButton.setAttribute("aria-label", this.composition ? "Compose captured elements" : this.region ? "Preview selected region" : "Preview selected element");
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
    if (this.region) {
      this.copyButton.disabled = true;
      this.previewButton.disabled = true;
      this.label.textContent = "Drag to select an area";
      this.label.style.cssText = "display:block;left:12px;top:58px";
      this.toolbar.style.cssText += ";left:12px;top:12px";
      for (const [corner, label] of [["nw", "top left"], ["ne", "top right"], ["sw", "bottom left"], ["se", "bottom right"]] as const) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "resize-handle";
        handle.dataset.corner = corner;
        handle.setAttribute("aria-label", `Resize selection from ${label}`);
        handle.title = `Resize from ${label}`;
        handle.hidden = true;
        this.regionHandles.set(corner, handle);
      }
    }
    this.root.append(style, this.box, this.label, this.toolbar, ...this.regionHandles.values());
    document.documentElement.append(this.host);
    this.syncToolbarBounds();
    this.root.addEventListener("keydown", (rawEvent) => {
      const event = rawEvent as KeyboardEvent;
      if (event.key !== "Tab") return;
      const controls = [...this.root.querySelectorAll<HTMLButtonElement>("button:not(:disabled):not([hidden])")];
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
    for (const [corner, handle] of this.regionHandles) {
      const x = corner.endsWith("w") ? rect.x : rect.x + rect.width;
      const y = corner.startsWith("n") ? rect.y : rect.y + rect.height;
      handle.style.left = `${x}px`;
      handle.style.top = `${y}px`;
    }
    this.label.textContent = this.region
      ? `${Math.round(rect.width)} × ${Math.round(rect.height)} px · visible area`
      : `${name} / visible area`;
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
      const gap = this.region ? 8 : 0;
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
          left: rect.x + rect.width + gap,
          top: clamp(y - toolbar.height / 2, innerHeight, toolbar.height),
        },
        {
          left: rect.x - toolbar.width - gap,
          top: clamp(y - toolbar.height / 2, innerHeight, toolbar.height),
        },
        {
          left: clamp(
            x - (copy.left - toolbar.left + copy.width / 2),
            innerWidth,
            toolbar.width,
          ),
          top: rect.y + rect.height + gap,
        },
        {
          left: clamp(
            x - (copy.left - toolbar.left + copy.width / 2),
            innerWidth,
            toolbar.width,
          ),
          top: rect.y - toolbar.height - gap,
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
      this.syncToolbarBounds();
    }
  }
  private syncToolbarBounds() {
    const placed = this.toolbar.getBoundingClientRect();
    this.toolbarBounds = {
      left: placed.left,
      right: placed.right,
      top: placed.top,
      bottom: placed.bottom,
    };
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
  setRegionReady(ready: boolean, keepHandles = false) {
    if (!this.region) return;
    this.copyButton.disabled = !ready;
    this.previewButton.disabled = !ready;
    if (!keepHandles) for (const handle of this.regionHandles.values()) handle.hidden = !ready;
  }
  setMessage(message: string) {
    this.label.textContent = message;
    this.label.style.display = "block";
  }
  isToolbarPoint(x: number, y: number) {
    const r = this.toolbarBounds;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  regionHandleAt(x: number, y: number): RectCorner | null {
    for (const [corner, handle] of this.regionHandles) {
      if (handle.hidden) continue;
      const rect = handle.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return corner;
    }
    return null;
  }
  focusRegionHandle(corner: RectCorner) {
    this.regionHandles.get(corner)?.focus({ preventScroll: true });
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
  sourceUrl?: string,
  capturedAt = Date.now(),
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
    .panel{position:absolute;inset:16px;margin:auto;width:min(1500px,calc(100vw - 32px));height:min(1000px,calc(100vh - 32px));display:grid;grid-template-rows:48px minmax(0,1fr);background:#f7f7f5;color:#202124;border:1px solid #d9dadd;border-radius:14px;box-shadow:0 22px 64px rgba(0,0,0,.26);overflow:hidden;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .head{display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid #e5e5e3;background:#fff;min-width:0}
    .identity{display:flex;align-items:baseline;gap:10px;min-width:0}.title{font-size:14px;font-weight:650;letter-spacing:-.2px}.meta{color:#73757a;font-size:11px;font-variant-numeric:tabular-nums}
    .frame-controls{display:flex;align-items:center;gap:5px;margin-left:auto;flex:none}.frame-picker{position:relative}.frame-trigger,.frame-meta-toggle{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:0 8px;color:#45474b;background:transparent;border:1px solid transparent;border-radius:7px;font:500 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap}.frame-trigger:hover,.frame-meta-toggle:hover{background:#f1f2f3;border-color:#e1e2e3}.frame-trigger[aria-expanded=true],.frame-meta-toggle[aria-pressed=true]{background:#eaf1ff;border-color:#cdddf8;color:#174da8}.frame-meta-toggle:disabled{opacity:.45;cursor:not-allowed}.frame-trigger svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6}.frame-chevron{width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);margin:-3px 2px 0}.frame-popover{position:absolute;z-index:6;right:0;top:calc(100% + 6px);width:190px;padding:5px;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:9px;box-shadow:0 8px 24px #0003}.frame-popover[hidden]{display:none}.frame-option{display:flex;align-items:center;gap:9px;width:100%;min-height:36px;padding:0 9px;background:transparent;border:0;border-radius:6px;color:inherit;text-align:left;font:500 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.frame-option:hover,.frame-option[aria-current=true]{background:color-mix(in srgb,Highlight 12%,Canvas)}.frame-option-icon{width:16px;height:12px;border:1px solid currentColor;border-radius:3px;flex:none}.frame-option-icon.mac{border-top:3px solid #9c9ea3;background:radial-gradient(circle at 4px 1px,#f46b64 0 1.5px,transparent 2px),radial-gradient(circle at 8px 1px,#e5b64d 0 1.5px,transparent 2px)}.frame-option-icon.windows{background:linear-gradient(currentColor,currentColor) 3px 8px/3px 1px no-repeat,linear-gradient(currentColor,currentColor) 8px 3px/4px 4px no-repeat}.frame-option-check{margin-left:auto;width:14px;height:14px}.frame-option[aria-current=true] .frame-option-check:after{content:"";display:block;width:6px;height:9px;border-right:2px solid #2165c9;border-bottom:2px solid #2165c9;transform:rotate(45deg);margin:0 0 0 3px}.capture-time{display:none;flex:none;margin-left:auto;padding:6px 0;color:#43464c;font:600 14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap}.capture-time.active{display:block}
    .toolbar-trailing{display:flex;align-items:center;gap:8px;flex:none}.actions{display:flex;align-items:center;gap:3px;flex:none}.action-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 10px;color:#313338;background:transparent;border:1px solid transparent;border-radius:7px;font-size:11px;font-weight:580;white-space:nowrap}.action-button:hover{background:#f1f2f3;border-color:#e1e2e3}.action-button:active,.tool-button:active{transform:translateY(1px)}.action-button.primary{color:#fff;background:#1f2937;border-color:#1f2937}.action-button.primary:hover{background:#111827;border-color:#111827}.action-button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .zoom-controls{display:flex;align-items:center;gap:3px;margin-left:0;padding:3px;background:#f3f3f1;border:1px solid #e5e5e3;border-radius:8px;flex:none}
    .zoom-button{display:grid;place-items:center;min-width:28px;height:28px;padding:0 6px;color:#45474b;background:transparent;border:1px solid transparent;border-radius:5px;font:500 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}
    .zoom-button:hover{background:#e8e9e9}.zoom-button:disabled{opacity:.4;cursor:default}.zoom-value{min-width:48px}
    .zoom-button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}
    .stage{position:relative;min-width:0;min-height:0;overflow:hidden;display:grid;grid-template-columns:50px minmax(0,1fr);grid-template-rows:minmax(0,1fr);align-items:stretch;background:#f0f0ee;padding:8px}
    .image-viewport{grid-column:2;grid-row:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-color:#a9aaad transparent;scrollbar-width:thin;cursor:default}.image-viewport.is-panning{cursor:grabbing;user-select:none}
    .canvas-wrap{width:max-content;height:max-content;min-width:100%;min-height:100%;display:flex;align-items:center;justify-content:center}.frame-surface{width:max-content;height:max-content;display:flex;flex-direction:column;align-items:center}.frame-surface.framed{position:relative;background:#e6e8eb;border-radius:16px;outline:1px solid #cfd2d6;outline-offset:-1px;overflow:hidden}
    canvas{display:block;min-width:0;min-height:0;max-width:none;max-height:none;width:auto;height:auto;object-fit:contain;background:#fff;border:1px solid rgba(0,0,0,.1);box-shadow:0 8px 28px rgba(0,0,0,.12);touch-action:none}.canvas-wrap.framed canvas{border:0;border-radius:0 0 9px 9px;box-shadow:0 8px 22px rgba(0,0,0,.2)}
    .frame-titlebar{display:none;position:relative;flex:none;align-items:center;grid-template-columns:76px minmax(0,1fr) max-content;gap:12px;box-sizing:border-box;overflow:hidden;border:0;background:#f6f7f8;color:#3f4146;font-family:sans-serif;font-weight:500;line-height:1.2}.frame-titlebar.active{display:grid}.frame-dots{display:flex;align-items:center;gap:8px}.frame-dots span{width:20px;height:20px;flex:none;border-radius:50%;background:#ff5f57}.frame-dots span:nth-child(2){background:#febc2e}.frame-dots span:nth-child(3){background:#28c840}.frame-window-controls{display:flex;align-items:center;justify-content:flex-end;gap:14px}.frame-window-controls span{width:11px;height:11px;flex:none;border:1px solid currentColor}.frame-url{min-width:0;max-width:100%;overflow:hidden;text-overflow:clip;white-space:nowrap;padding:5px 12px;border-radius:7px;background:#e9eaec;text-align:left;color:#3f4146;font-family:sans-serif;font-weight:500;line-height:1.25}.frame-titlebar[data-style=mac] .frame-window-controls,.frame-titlebar[data-style=windows] .frame-dots,.frame-titlebar[data-style=none] .frame-window-controls{display:none}.frame-titlebar[data-style=windows]{grid-template-columns:minmax(0,1fr) max-content 72px}.frame-titlebar[data-style=windows] .frame-url{grid-column:1}.frame-titlebar[data-style=windows] .capture-time{grid-column:2}.frame-titlebar[data-style=windows] .frame-window-controls{grid-column:3}.frame-titlebar[data-style=none] .capture-time{grid-column:2}.frame-titlebar[data-style=windows] .frame-window-controls span:first-child{height:1px;border:0;background:currentColor}.frame-titlebar[data-style=windows] .frame-window-controls span:last-child{position:relative;border:0}.frame-titlebar[data-style=windows] .frame-window-controls span:last-child:before,.frame-titlebar[data-style=windows] .frame-window-controls span:last-child:after{content:"";position:absolute;left:5px;top:0;width:1px;height:12px;background:currentColor;transform:rotate(45deg)}.frame-titlebar[data-style=windows] .frame-window-controls span:last-child:after{transform:rotate(-45deg)}.capture-time{display:none;min-width:0;margin-left:auto;overflow:hidden;text-overflow:clip;white-space:nowrap;color:#3f4146;font-family:sans-serif;font-weight:600;line-height:1.2;text-align:right}.capture-time.active{display:block}
    .frame-titlebar[data-stacked=true]{grid-template-rows:repeat(2,minmax(0,1fr));row-gap:0}.frame-titlebar[data-stacked=true][data-style=mac]{grid-template-columns:76px minmax(0,1fr) 0}.frame-titlebar[data-stacked=true][data-style=windows]{grid-template-columns:minmax(0,1fr) 72px}.frame-titlebar[data-stacked=true] .frame-dots,.frame-titlebar[data-stacked=true] .frame-window-controls{grid-row:1}.frame-titlebar[data-stacked=true][data-style=mac] .frame-url{grid-row:1;grid-column:2/4}.frame-titlebar[data-stacked=true][data-style=windows] .frame-url{grid-row:1;grid-column:1}.frame-titlebar[data-stacked=true][data-style=windows] .frame-window-controls{grid-column:2}.frame-titlebar[data-stacked=true] .capture-time{grid-row:2;grid-column:1/-1;justify-self:end;max-width:100%!important;margin:0}
    .annotation-tools{grid-column:1;grid-row:1;z-index:2;align-self:center;display:flex;flex-direction:column;align-items:center;gap:4px;width:40px;max-height:100%;overflow-y:auto;scrollbar-width:thin;padding:4px;background:#fff;border:1px solid #dedfdf;border-radius:11px;box-shadow:0 2px 8px rgba(0,0,0,.07)}
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
    .status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    button:focus-visible,input:focus-visible{outline:2px solid #4b83e6;outline-offset:2px}.image-viewport:focus-visible{outline:2px solid #4b83e6;outline-offset:-2px}
    @media(prefers-color-scheme:dark){.panel{background:#202124;color:#f1f3f4;border-color:#3b3d40}.head{background:#252629;border-color:#3b3d40}.stage{background:#1b1c1e}.meta,.status{color:#aeb0b5}.status{background:color-mix(in srgb,#292b2e 90%,transparent);border-color:#414348}.zoom-controls{background:#292b2e;border-color:#414348}.zoom-button{color:#d1d3d7}.zoom-button:hover{background:#383a3e}.annotation-tools{background:#292b2e;border-color:#414348;box-shadow:0 3px 14px #0006}.tool-button,.close-button{color:#d1d3d7}.tool-button:hover,.close-button:hover,.action-button:hover{background:#383a3e;color:#fff}.tool-button[aria-pressed=true]{color:#a9c7ff;background:#253a5f;border-color:#365681}.tool-divider{background:#484a4e}.annotation-tools input[type=color]{background:#292b2e;border-color:#55585d}.canvas-text-input{color:#f1f3f4;text-shadow:0 1px 2px rgba(0,0,0,.65)}.action-button{color:#e1e3e6;background:transparent;border-color:transparent}.action-button.primary{color:#202124;background:#e8eaed;border-color:#e8eaed}.action-button.primary:hover{background:#fff}.frame-trigger,.frame-meta-toggle{color:#d1d3d7;background:transparent;border-color:transparent}.frame-trigger:hover,.frame-meta-toggle:hover{background:#35373b;border-color:#65676d}.frame-trigger[aria-expanded=true],.frame-meta-toggle[aria-pressed=true]{color:#a9c7ff;background:#253a5f;border-color:#365681}.frame-popover{background:#292b2e;color:#e1e3e6;border-color:#4a4c50}.frame-option:hover,.frame-option[aria-current=true]{background:#383a3e}}
    @media(max-width:900px){.head{gap:4px;padding:0 8px}.identity{gap:6px}.title{font-size:12px}.frame-controls{gap:1px}.frame-trigger,.frame-meta-toggle{padding:0 6px}.action-button{padding:0 7px}.zoom-button{min-width:25px}.zoom-value{min-width:42px}}
    @media(max-width:700px){.panel{inset:8px;width:calc(100vw - 16px);height:calc(100vh - 16px);grid-template-rows:46px minmax(0,1fr);border-radius:12px}.head{padding:0 7px;gap:3px}.stage{grid-template-columns:44px minmax(0,1fr);padding:8px}.annotation-tools{width:38px;padding:3px;gap:3px}.tool-button{width:29px;height:29px}.tool-button svg{width:16px;height:16px}.action-button{width:34px;height:32px;padding:0;font-size:0}.action-button svg{width:16px;height:16px}.identity{gap:7px}.title{font-size:12px}.zoom-controls{gap:0;padding:2px}.zoom-button{min-width:26px;height:26px}.frame-controls{max-width:190px;overflow-x:auto}}
    @media(max-width:520px){.meta{display:none}.frame-controls{max-width:126px}.frame-trigger,.frame-meta-toggle{padding:0 4px;font-size:10px}.zoom-value{min-width:35px}.zoom-button{min-width:22px;padding:0 3px}.identity{max-width:86px;overflow:hidden}.title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.close-button{width:28px;height:30px}.actions{gap:0}.toolbar-trailing{gap:4px}}
    @media(max-width:420px){.identity{max-width:48px}.title{font-size:11px}.frame-controls{max-width:115px}}
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
  let zoom = 1,
    fitMode: "whole" | "width" | "custom" = "whole";
  let frameStyle: WindowFrameStyle = "none", showUrl = false, showTimestamp = false;
  let refreshFrame = () => {};
  const frameControls = createFrameControls(sourceUrl, (state) => {
    frameStyle = state.frameStyle;
    showUrl = state.showUrl;
    showTimestamp = state.showTimestamp;
    refreshFrame();
  });
  frameControls.attachDismiss(root);
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
  const actions = document.createElement("div");
  actions.className = "actions";
  const button = (label: string, glyph: string, primary = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `action-button${primary ? " primary" : ""}`;
    b.textContent = label;
    b.setAttribute("aria-label", label);
    b.title = label;
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
  const toolbarTrailing = document.createElement("div");
  toolbarTrailing.className = "toolbar-trailing";
  toolbarTrailing.append(actions, zoomControls, closeButton);
  head.append(identity, frameControls.element, toolbarTrailing);
  const stage = document.createElement("div");
  stage.className = "stage";
  const imageViewport = document.createElement("div");
  imageViewport.className = "image-viewport";
  imageViewport.setAttribute("role", "region");
  imageViewport.setAttribute("aria-label", "Screenshot canvas. Hold Space and drag to pan.");
  imageViewport.setAttribute("aria-keyshortcuts", "Space");
  imageViewport.tabIndex = 0;
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  const frameSurface = document.createElement("div");
  frameSurface.className = "frame-surface";
  const frameTitlebar = document.createElement("div");
  frameTitlebar.className = "frame-titlebar";
  frameTitlebar.setAttribute("aria-hidden", "true");
  const frameDots = document.createElement("div");
  frameDots.className = "frame-dots";
  frameDots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  const frameUrl = document.createElement("div");
  frameUrl.className = "frame-url";
  frameUrl.textContent = displaySourceUrl(sourceUrl) ?? "";
  const frameWindowControls = document.createElement("div");
  frameWindowControls.className = "frame-window-controls";
  frameWindowControls.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  const captureTime = document.createElement("div");
  captureTime.className = "capture-time";
  captureTime.setAttribute("aria-label", "Capture date and time");
  captureTime.textContent = formatCaptureTime(capturedAt) ?? "";
  frameTitlebar.append(frameDots, frameUrl, captureTime, frameWindowControls);
  refreshFrame = () => {
    const active = frameStyle !== "none";
    frameSurface.classList.toggle("framed", active || showTimestamp);
    frameTitlebar.classList.toggle("active", active || showTimestamp);
    captureTime.classList.toggle("active", showTimestamp);
    frameTitlebar.dataset.style = frameStyle;
    frameUrl.hidden = !active;
    const dimensions = frameDimensions(width, height, frameStyle, showTimestamp);
    frameTitlebar.dataset.stacked = String(dimensions.stackMetadata);
    frameTitlebar.style.width = `${Math.round(dimensions.width * zoom)}px`;
    frameTitlebar.style.height = `${Math.round(dimensions.bar * zoom)}px`;
    frameTitlebar.style.paddingTop = "0";
    frameTitlebar.style.fontSize = `${Math.max(16, Math.min(30, Math.round(dimensions.bar * 0.28))) * zoom}px`;
    const outerRadius = Math.max(8, Math.min(18, Math.round(Math.min(width, height) * 0.025))) * zoom;
    frameTitlebar.style.borderRadius = `${outerRadius}px ${outerRadius}px 0 0`;
    frameSurface.style.borderRadius = active ? `${outerRadius}px` : "0";
    frameTitlebar.style.paddingLeft = `${(dimensions.inset + (frameStyle === "windows" ? 18 : 12)) * zoom}px`;
    frameTitlebar.style.paddingRight = `${(dimensions.inset + 18) * zoom}px`;
    frameTitlebar.style.gridTemplateColumns = dimensions.stackMetadata
      ? frameStyle === "windows" ? `minmax(0,1fr) ${72 * zoom}px` : `${76 * zoom}px minmax(0,1fr) 0px`
      : frameStyle === "windows" ? `minmax(0,1fr) max-content ${72 * zoom}px`
        : frameStyle === "none" ? `minmax(0,1fr) max-content` : `${76 * zoom}px minmax(0,1fr) max-content`;
    frameTitlebar.style.gridTemplateRows = dimensions.stackMetadata ? "repeat(2,minmax(0,1fr))" : "";
    frameTitlebar.style.gap = `${(frameStyle === "windows" ? 18 : 12) * zoom}px`;
    frameUrl.textContent = showUrl ? displaySourceUrl(sourceUrl) ?? "" : "";
    frameUrl.style.fontSize = `${(dimensions.stackMetadata ? Math.max(12, Math.min(16, Math.round(width * 0.04))) : Math.max(16, Math.min(30, Math.round(dimensions.bar * 0.28)))) * zoom}px`;
    frameUrl.style.height = `${dimensions.bar * (dimensions.stackMetadata ? 0.34 : 0.54) * zoom}px`;
    frameUrl.style.padding = `0 ${12 * zoom}px`;
    frameUrl.style.borderRadius = `${dimensions.bar * 0.14 * zoom}px`;
    frameUrl.style.marginRight = "0";
    const urlLeft = frameStyle === "mac" ? dimensions.inset + 100 : dimensions.inset + 18;
    const timeMetrics = captureTimeMetrics(width, dimensions.width);
    const timeWidth = Math.min(timeMetrics.maxWidth, frameStyle === "windows" ? 320 : timeMetrics.maxWidth);
    const reserveTime = showTimestamp && !dimensions.stackMetadata ? timeWidth + (frameStyle === "windows" ? 116 : 40) : 0;
    const urlRight = dimensions.width - dimensions.inset - (reserveTime || (frameStyle === "windows" ? 96 : 18));
    let urlWidth = Math.min(Math.max(0, urlRight - urlLeft), Math.round(dimensions.width * 0.46));
    if (frameStyle === "mac" && showTimestamp && !dimensions.stackMetadata) {
      const timestampLeft = dimensions.width - dimensions.inset - timeMetrics.maxWidth - 18;
      urlWidth = Math.min(urlWidth, Math.max(0, Math.floor(2 * (timestampLeft - dimensions.width / 2 - 16))));
    }
    frameUrl.style.width = `${urlWidth * zoom}px`;
    frameUrl.style.maxWidth = `${urlWidth * zoom}px`;
    frameUrl.style.justifySelf = frameStyle === "mac" ? "center" : "stretch";
    frameUrl.style.position = frameStyle === "mac" ? "absolute" : "";
    frameUrl.style.left = frameStyle === "mac" ? `${(dimensions.width - urlWidth) / 2 * zoom}px` : "";
    frameUrl.style.top = frameStyle === "mac" ? `${(dimensions.stackMetadata ? dimensions.bar * 0.08 : dimensions.bar * 0.23) * zoom}px` : "";
    frameUrl.style.transform = "none";
    captureTime.style.fontSize = `${(dimensions.stackMetadata ? Math.max(12, Math.min(14, Math.round(width * 0.05))) : timeMetrics.fontSize) * zoom}px`;
    const timeBoxWidth = dimensions.stackMetadata ? dimensions.width - dimensions.inset * 2 - 36 : timeWidth;
    captureTime.style.width = `${timeBoxWidth * zoom}px`;
    captureTime.style.maxWidth = `${timeBoxWidth * zoom}px`;
    const macInlineTime = frameStyle === "mac" && showTimestamp && !dimensions.stackMetadata;
    captureTime.style.position = macInlineTime ? "absolute" : "";
    captureTime.style.right = macInlineTime ? `${(dimensions.inset + 18) * zoom}px` : "";
    captureTime.style.top = macInlineTime ? `${dimensions.bar / 2 * zoom}px` : "";
    captureTime.style.transform = macInlineTime ? "translateY(-50%)" : "";
    for (const dot of frameDots.children) {
      (dot as HTMLElement).style.width = `${20 * zoom}px`;
      (dot as HTMLElement).style.height = `${20 * zoom}px`;
    }
    canvas.style.margin = active || showTimestamp ? `0 ${Math.round(dimensions.inset * zoom)}px ${Math.round(dimensions.inset * zoom)}px` : "0";
    const radius = Math.max(6, Math.min(16, Math.round(Math.min(width, height) * 0.02))) * zoom;
    canvas.style.borderRadius = active ? `0 0 ${radius}px ${radius}px` : "0";
  };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute(
    "aria-label",
    `Captured image, ${width} by ${height} pixels`,
  );
  refreshFrame();
  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent =
    "Choose a tool, then annotate directly on the screenshot.";
  frameSurface.append(frameTitlebar, canvas);
  canvasWrap.append(frameSurface);
  imageViewport.append(canvasWrap);
  stage.append(imageViewport);
  stage.append(status);
  panel.append(head, stage);
  root.append(style, backdrop, panel);
  document.documentElement.append(host);
  const MIN_ZOOM = 0.05,
    MAX_ZOOM = 4;
  const renderZoom = () => {
    canvas.style.width = `${Math.round(width * zoom)}px`;
    canvas.style.height = `${Math.round(height * zoom)}px`;
    refreshFrame();
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
      frame = frameDimensions(width, height, frameStyle, showTimestamp),
      worldWidth = frameStyle !== "none" || showTimestamp ? frame.width : width,
      worldHeight = frameStyle !== "none" || showTimestamp ? frame.height : height,
      sceneRect = (frameStyle !== "none" || showTimestamp ? frameTitlebar : canvas).getBoundingClientRect(),
      anchorX = Math.max(
        0,
        Math.min(
          worldWidth,
          (viewportRect.left + imageViewport.clientWidth / 2 - sceneRect.left) / Math.max(0.001, zoom),
        ),
      ),
      anchorY = Math.max(
        0,
        Math.min(
          worldHeight,
          (viewportRect.top + imageViewport.clientHeight / 2 - sceneRect.top) / Math.max(0.001, zoom),
        ),
      );
    fitMode = "custom";
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    renderZoom();
    const nextRect = (frameStyle !== "none" || showTimestamp ? frameTitlebar : canvas).getBoundingClientRect();
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
    const frame = frameDimensions(width, height, frameStyle, showTimestamp);
    const displayWidth = frameStyle !== "none" || showTimestamp ? frame.width : width;
    const displayHeight = frameStyle !== "none" || showTimestamp ? frame.height : height;
    zoom = Math.min(1, imageViewport.clientWidth / displayWidth, imageViewport.clientHeight / displayHeight);
    renderZoom();
    imageViewport.scrollLeft = 0;
    imageViewport.scrollTop = 0;
  };
  const fitWidth = () => {
    if (!imageViewport.clientWidth) return;
    fitMode = "width";
    const frame = frameDimensions(width, height, frameStyle, showTimestamp);
    const displayWidth = frameStyle !== "none" || showTimestamp ? frame.width : width;
    zoom = Math.min(1, imageViewport.clientWidth / displayWidth);
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
  let spacePan = false;
  let panOrigin: { x: number; y: number; left: number; top: number } | undefined;
  let disposeAnnotations: AnnotationAttachment = Object.assign(() => {}, {
    render: () => {}, renderForExport: () => {}, undo: () => {}, redo: () => {},
  });
  const dispose = () => {
    if (removed) return;
    removed = true;
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("keyup", keyup, true);
    window.removeEventListener("blur", cancelPan);
    imageViewport.removeEventListener("pointerdown", panPointerDown, true);
    imageViewport.removeEventListener("pointermove", panPointerMove, true);
    imageViewport.removeEventListener("pointerup", panPointerUp, true);
    imageViewport.removeEventListener("pointercancel", panPointerUp, true);
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
    const focusedElement = root.activeElement;
    if (event.code === "Space" && focusedElement === imageViewport) {
      spacePan = true;
      event.preventDefault();
      return;
    }
    if (
      event.key === "Escape" &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement) &&
      !(focusedElement instanceof HTMLInputElement) &&
      !(focusedElement instanceof HTMLTextAreaElement)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dispose();
      return;
    }
    if (
      event.target instanceof HTMLInputElement ||
      focusedElement instanceof HTMLInputElement ||
      focusedElement instanceof HTMLTextAreaElement ||
      focusedElement instanceof HTMLButtonElement ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
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
  const keyup = (event: KeyboardEvent) => {
    if (event.code === "Space") spacePan = false;
  };
  const cancelPan = () => {
    panOrigin = undefined;
    imageViewport.classList.remove("is-panning");
  };
  const panPointerDown = (event: PointerEvent) => {
    if (!(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLInputElement))
      imageViewport.focus({ preventScroll: true });
    if (!spacePan || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    panOrigin = { x: event.clientX, y: event.clientY, left: imageViewport.scrollLeft, top: imageViewport.scrollTop };
    imageViewport.classList.add("is-panning");
    imageViewport.setPointerCapture(event.pointerId);
  };
  const panPointerMove = (event: PointerEvent) => {
    if (!panOrigin) return;
    imageViewport.scrollLeft = panOrigin.left - (event.clientX - panOrigin.x);
    imageViewport.scrollTop = panOrigin.top - (event.clientY - panOrigin.y);
  };
  const panPointerUp = () => cancelPan();
  imageViewport.addEventListener("pointerdown", panPointerDown, true);
  imageViewport.addEventListener("pointermove", panPointerMove, true);
  imageViewport.addEventListener("pointerup", panPointerUp, true);
  imageViewport.addEventListener("pointercancel", panPointerUp, true);
  window.addEventListener("blur", cancelPan);
  document.addEventListener("keyup", keyup, true);
  document.addEventListener("keydown", keydown, true);
  closeButton.addEventListener("click", dispose);
  backdrop.addEventListener("click", dispose);
  const canvasBlob = () => new Promise<Blob>((resolve, reject) => {
    if (frameStyle === "none" && !showTimestamp) {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG export failed.")), "image/png");
      return;
    }
    const dimensions = frameDimensions(width, height, frameStyle, showTimestamp);
    if (dimensions.width * dimensions.height > 40_000_000) {
      reject(new Error("The framed image is too large to export safely. Turn the frame off or use a smaller capture."));
      return;
    }
    const output = document.createElement("canvas");
    output.width = dimensions.width;
    output.height = dimensions.height;
    const context = output.getContext("2d");
    if (!context) { reject(new Error("Could not prepare the framed PNG.")); return; }
    drawWindowFrame(context, width, height, frameStyle, sourceUrl, showUrl, showTimestamp, capturedAt);
    context.save();
    clipWindowContent(context, width, height, frameStyle, showTimestamp);
    disposeAnnotations.renderForExport(context);
    context.restore();
    output.toBlob((blob) => {
      output.width = output.height = 1;
      if (blob) resolve(blob);
      else reject(new Error("PNG export failed."));
    }, "image/png");
  });
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
