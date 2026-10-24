import type { Rect } from "./shared/geometry";

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
  private readonly copyLabel = document.createElement("span");
  private toolbarBounds = { left: 0, right: 0, top: 0, bottom: 0 };
  private selectionRect: Rect | null = null;
  constructor(actions: {
    cancel: () => void;
    preview: () => void;
    copy: () => void;
  }) {
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
      button{display:flex;align-items:center;justify-content:center;gap:7px;color:#f5f4ef;background:transparent;border:0;border-radius:4px;padding:6px;font:inherit;cursor:pointer}button:hover{background:#41413b}button:focus-visible{outline:2px solid #f5f4ef;outline-offset:2px}button:disabled{opacity:.3;cursor:default}kbd{font:10px/16px -apple-system,BlinkMacSystemFont,sans-serif;border:1px solid #66665c;border-radius:3px;padding:0 4px;color:#d6d5cc}
      @media(max-width:620px){.toolbar{gap:2px;padding:3px}}
    `;
    this.box.className = "box";
    this.label.className = "label";
    this.toolbar.className = "toolbar";
    this.label.setAttribute("role", "status");
    this.label.setAttribute("aria-live", "polite");
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", "Element selection");
    this.copyButton.type = "button";
    this.copyButton.className = "copy";
    this.copyButton.setAttribute("aria-label", "Copy selected element");
    this.copyButton.title = "Capture and copy without opening the preview";
    this.copyLabel.textContent = "Copy";
    this.copyButton.append(
      icon(
        "M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z",
      ),
      this.copyLabel,
    );
    this.copyButton.addEventListener("click", actions.copy);
    this.previewButton.type = "button";
    this.previewButton.textContent = "Preview";
    this.previewButton.setAttribute("aria-label", "Preview selected element");
    this.previewButton.title = "Open image preview (Enter)";
    this.previewButton.addEventListener("click", actions.preview);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Esc";
    cancel.setAttribute("aria-label", "Cancel selection");
    cancel.title = "Cancel selection (Escape)";
    cancel.addEventListener("click", actions.cancel);
    this.toolbar.append(this.copyButton, this.previewButton, cancel);
    this.root.append(style, this.box, this.label, this.toolbar);
    document.documentElement.append(this.host);
  }
  show(rect: Rect | null, name = "", x?: number, y?: number) {
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
      const centeredLeft = Math.max(4, Math.min(innerWidth - toolbar.width - 4, x - (copy.left - toolbar.left + copy.width / 2)));
      const centeredTop = Math.max(4, Math.min(innerHeight - toolbar.height - 4, y - (copy.top - toolbar.top + copy.height / 2)));
      const clamp = (v: number, max: number, size: number) => Math.max(4, Math.min(max - size - 4, v));
      const intersects = (a: {left:number;top:number;right:number;bottom:number}, b: Rect) => a.left < b.x+b.width && a.right > b.x && a.top < b.y+b.height && a.bottom > b.y;
      const candidates = [
        { left: rect.x + rect.width, top: clamp(y - toolbar.height / 2, innerHeight, toolbar.height) },
        { left: rect.x - toolbar.width, top: clamp(y - toolbar.height / 2, innerHeight, toolbar.height) },
        { left: clamp(x - (copy.left - toolbar.left + copy.width / 2), innerWidth, toolbar.width), top: rect.y + rect.height },
        { left: clamp(x - (copy.left - toolbar.left + copy.width / 2), innerWidth, toolbar.width), top: rect.y - toolbar.height },
      ].filter(p => p.left >= 4 && p.top >= 4 && p.left + toolbar.width <= innerWidth - 4 && p.top + toolbar.height <= innerHeight - 4 && !intersects({ left:p.left,top:p.top,right:p.left+toolbar.width,bottom:p.top+toolbar.height }, rect));
      const score = (p: {left:number;top:number}) => { const dx = x < p.left ? p.left-x : x > p.left+toolbar.width ? x-(p.left+toolbar.width) : 0; const dy = y < p.top ? p.top-y : y > p.top+toolbar.height ? y-(p.top+toolbar.height) : 0; return dx*dx+dy*dy; };
      const adjacent = candidates.sort((a,b)=>score(a)-score(b))[0];
      const left = adjacent?.left ?? centeredLeft;
      const top = adjacent?.top ?? centeredTop;
      this.toolbar.style.left = `${left}px`;
      this.toolbar.style.top = `${top}px`;
      const placed = this.toolbar.getBoundingClientRect();
      this.toolbarBounds = { left: placed.left, right: placed.right, top: placed.top, bottom: placed.bottom };
    }
  }
  setCopyBusy(busy: boolean) {
    this.copyButton.disabled = busy;
    this.copyLabel.textContent = busy ? "Copying…" : "Copy";
  }
  isToolbarPoint(x: number, y: number) {
    const r = this.toolbarBounds;
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  isToolbarReachPoint(x: number, y: number) {
    const r = this.toolbarBounds;
    const pad = 6;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
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

export function showPreview(png: string, width: number, height: number, close: () => void): () => void {
  const host = document.createElement("precision-preview");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `*{box-sizing:border-box}.panel{pointer-events:auto;position:fixed;right:24px;bottom:24px;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;background:#f7f6f2;color:#22221f;border:1px solid #d8d7d0;border-radius:10px;box-shadow:0 12px 40px #0003;padding:14px;font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.head,.actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.title{font-weight:600}.meta{color:#66665e;font-size:12px}canvas{display:block;max-width:100%;max-height:58vh;width:auto;height:auto;object-fit:contain;margin:12px auto;background:#e9e8e2;border:1px solid #d8d7d0;border-radius:4px}.actions{justify-content:flex-end;border-top:1px solid #deddd7;padding-top:12px}button{font:inherit;color:#282824;background:transparent;border:1px solid #c9c8c0;border-radius:5px;padding:7px 11px;cursor:pointer}button:hover{background:#e9e8e2}button.primary{background:#282824;color:#f7f6f2;border-color:#282824}button:focus-visible{outline:2px solid #5573a5;outline-offset:2px}.status{min-height:18px;color:#56564f;font-size:12px}@media(prefers-color-scheme:dark){.panel{background:#242421;color:#f5f4ef;border-color:#55554e}.meta,.status{color:#c2c1b9}canvas{background:#33332f;border-color:#55554e}button{color:#f5f4ef;border-color:#66665c}button:hover{background:#41413b}button.primary{background:#f5f4ef;color:#242421;border-color:#f5f4ef}.actions{border-color:#55554e}}@media(max-width:620px){.panel{left:12px;right:12px;bottom:12px;width:auto;max-height:70vh}canvas{max-height:38vh}}`;
  const panel = document.createElement("section"); panel.className = "panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Captured image");
  const head = document.createElement("div"); head.className = "head";
  const heading = document.createElement("span"); heading.className = "title"; heading.textContent = "Capture";
  const dimensions = document.createElement("span"); dimensions.className = "meta"; dimensions.textContent = `${width} × ${height} px`;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; canvas.setAttribute("aria-label", `Captured image, ${width} by ${height} pixels`);
  const status = document.createElement("div"); status.className = "status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const actions = document.createElement("div"); actions.className = "actions";
  const button = (label: string, primary = false) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-label", label); if (primary) b.className = "primary"; return b; };
  const copy = button("Copy image", true), download = button("Download PNG"), dismiss = button("Close");
  head.append(heading, dimensions); actions.append(copy, download, dismiss); panel.append(head, canvas, status, actions); root.append(style, panel); document.documentElement.append(host);
  const blobUrls: string[] = [];
  let removed = false;
  const dispose = () => { if (removed) return; removed = true; document.removeEventListener("keydown", keydown, true); for (const blobUrl of blobUrls) URL.revokeObjectURL(blobUrl); blobUrls.length = 0; host.remove(); close(); };
  const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); dispose(); } };
  document.addEventListener("keydown", keydown, true); dismiss.addEventListener("click", dispose);
  copy.addEventListener("click", () => { try { if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Clipboard image support is unavailable. Download the PNG instead."); void navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([Uint8Array.from(atob(png.split(",")[1]!), c => c.charCodeAt(0))], { type: "image/png" }) })]).then(() => { status.textContent = "Copied to clipboard"; }, () => { status.textContent = "Copy was blocked. Try again or download the PNG."; }); } catch (error) { status.textContent = error instanceof Error ? error.message : "Copy failed. Download the PNG instead."; } });
  download.addEventListener("click", () => { try { const bytes = Uint8Array.from(atob(png.split(",")[1]!), c => c.charCodeAt(0)); const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" })); blobUrls.push(blobUrl); const a = document.createElement("a"); a.href = blobUrl; a.download = `precision-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.png`; a.click(); status.textContent = "PNG download started"; } catch { status.textContent = "Download failed. Try copying the image instead."; } });
  void createImageBitmap(new Blob([Uint8Array.from(atob(png.split(",")[1]!), c => c.charCodeAt(0))], { type: "image/png" })).then(bitmap => { if (removed) { bitmap.close(); return; } const ctx = canvas.getContext("2d"); if (ctx) ctx.drawImage(bitmap, 0, 0); bitmap.close(); }).catch(() => { status.textContent = "Image preview could not be displayed. You can still download it."; });
  copy.focus({ preventScroll: true });
  return dispose;
}
