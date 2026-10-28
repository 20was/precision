export type AnnotationTool =
  "select" | "pen" | "arrow" | "rectangle" | "text" | "spotlight" | "blur" | "mask";
type MarkTool = Exclude<AnnotationTool, "select">;
type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
import { clientToCanvasPoint } from "./shared/editor-geometry";

export interface AnnotationOptions {
  drawBase?: (context: CanvasContext) => void;
  drawForeground?: (context: CanvasContext) => void;
  onToolChange?: (tool: AnnotationTool) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
  onHistoryCommit?: () => void;
}

export type AnnotationAttachment = (() => void) & {
  render: () => void;
  renderForExport: (context: CanvasContext) => void;
  undo: () => void;
  redo: () => void;
};

type Point = { x: number; y: number };
type Mark = {
  tool: MarkTool;
  color: string;
  points: Point[];
  text?: string;
};

/** Adds non-destructive annotations to a screenshot canvas, never the source page. */
export function attachAnnotations(
  canvas: HTMLCanvasElement,
  status: HTMLElement,
  basePng: string,
  toolbarParent?: HTMLElement,
  textEditorParent?: HTMLElement,
  options: AnnotationOptions = {},
): AnnotationAttachment {
  const toolbar = document.createElement("div");
  toolbar.className = "annotation-tools";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Screenshot annotation tools");
  const objectList = document.createElement("details"),
    objectListSummary = document.createElement("summary"),
    objectListItems = document.createElement("ul");
  objectList.className = "annotation-list";
  objectListSummary.textContent = "Annotations";
  objectList.setAttribute("aria-label", "Annotation objects");
  objectListItems.setAttribute("role", "list");
  objectList.append(objectListSummary, objectListItems);

  const marks: Mark[] = [];
  const history: Mark[][] = [[]];
  let historyIndex = 0;
  const toolButtons = new Map<AnnotationTool, HTMLButtonElement>();
  let tool: AnnotationTool = "select";
  let color = "#e5484d";
  const toolColors: Partial<Record<MarkTool, string>> = {
    blur: "#596273",
    mask: "#202124",
  };
  let colorEditBefore: Mark[] | undefined;
  let draft: Mark | undefined;
  let bitmap: ImageBitmap | undefined;
  const blurSurface = document.createElement("canvas");
  let disposed = false;
  let textEditor: HTMLInputElement | undefined;
  let editingMark: Mark | undefined;
  let selectedMark: Mark | undefined;
  let markDrag:
    { mark: Mark; start: Point; origins: Point[]; moved: boolean; resizeCorner?: number; anchor?: Point } | undefined;

  const iconPaths: Record<string, string> = {
    Select: "M5 3l14 11-7 1-3 6L5 3Z",
    Pen: "m12 19 7-7 3 3-7 7H12v-3ZM18 13l-3-3 2-2a2 2 0 0 1 3 3l-2 2ZM4 20l4.5-1.2L5.2 15.5 4 20Z",
    Arrow: "M5 12h14m-6-6 6 6-6 6",
    Rectangle: "M4 5h16v14H4z",
    Text: "M5 5h14M12 5v14",
    Spotlight:
      "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    Blur: "M4 4h16v16H4zM7 7h3v3H7zM14 7h3v3h-3zM7 14h3v3H7zM14 14h3v3h-3zM11 11h2v2h-2z",
    Mask: "M4 4h16v16H4z",
    Undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2",
    Redo: "m15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2",
    Clear: "M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3",
  };
  const makeButton = (label: string, action: () => void, pressed?: boolean) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-button";
    button.setAttribute("aria-label", label);
    button.title = label;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", iconPaths[label] ?? "");
    svg.append(path);
    button.append(svg);
    if (pressed !== undefined)
      button.setAttribute("aria-pressed", String(pressed));
    button.addEventListener("click", action);
    return button;
  };
  const selectTool = (next: AnnotationTool) => {
    tool = next;
    if (next !== "select") selectedMark = undefined;
    colorInput.value = next === "mask" || next === "blur" ? toolColors[next]! : selectedMark?.color ?? color;
    options.onToolChange?.(tool);
    for (const [name, button] of toolButtons)
      button.setAttribute("aria-pressed", String(name === tool));
    canvas.style.cursor =
      tool === "text" ? "text" : tool === "select" ? "default" : "crosshair";
    status.textContent =
      tool === "select"
        ? "Select or move marks · Hold Space and drag to pan · Choose a tool to annotate."
        : tool === "text"
        ? "Text: click the image and type directly. Press Enter to place. Hold Alt/Option to add over a mark."
          : tool === "spotlight"
            ? "Spotlight: drag to keep an area bright and dim the rest. Hold Alt/Option to overlap marks."
      : `${next === "pen" ? "Pen" : next === "arrow" ? "Arrow" : next === "blur" ? "Blur" : next === "mask" ? "Solid mask (opaque redaction)" : "Rectangle"}: drag on the image. Hold Alt/Option to draw over existing marks.`;
  };
  for (const [name, label] of [
    ["select", "Select"],
    ["pen", "Pen"],
    ["arrow", "Arrow"],
    ["rectangle", "Rectangle"],
    ["text", "Text"],
    ["spotlight", "Spotlight"],
    ["blur", "Blur"],
    ["mask", "Mask"],
  ] as const) {
    const button = makeButton(label, () => selectTool(name), name === tool);
    const shortcut: Record<AnnotationTool, string> = {
      select: "V",
      pen: "P",
      arrow: "A",
      rectangle: "R",
      text: "T",
      spotlight: "S",
      blur: "B",
      mask: "M",
    };
    button.title = `${label} (${shortcut[name]})`;
    toolButtons.set(name, button);
    toolbar.append(button);
  }
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = color;
  colorInput.setAttribute("aria-label", "Annotation color");
  colorInput.title = "Annotation color";
  const cloneMarks = () => marks.map((mark) => ({
    ...mark,
    points: mark.points.map((point) => ({ ...point })),
  }));
  colorInput.addEventListener("focus", () => { colorEditBefore ??= cloneMarks(); });
  colorInput.addEventListener("input", () => {
    colorEditBefore ??= cloneMarks();
    color = colorInput.value;
    if (selectedMark && tool === "select") selectedMark.color = color;
    else if (tool === "mask" || tool === "blur") toolColors[tool] = color;
    if (textEditor) {
      textEditor.style.color = color;
      textEditor.dataset.annotationColor = color;
    }
    render();
  });
  colorInput.addEventListener("change", () => {
    if (colorEditBefore) {
      if (selectedMark && tool === "select") pushHistory(colorEditBefore);
      colorEditBefore = undefined;
      status.textContent = selectedMark && tool === "select" ? "Annotation color updated" : tool === "mask" ? "Mask color updated for new redactions" : tool === "blur" ? "Blur tint updated for new redactions" : "Annotation color updated for new marks";
      render();
    }
  });
  toolbar.append(colorInput);
  selectTool(tool);

  function pushHistory(previous?: Mark[]) {
    history.splice(historyIndex + 1);
    if (previous) history[historyIndex] = previous;
    history.push(cloneMarks());
    if (history.length > 101) history.shift();
    historyIndex = history.length - 1;
    options.onHistoryCommit?.();
  }
  function restoreHistory(index: number) {
    historyIndex = index;
    marks.splice(
      0,
      marks.length,
      ...history[index]!.map((mark) => ({
        ...mark,
        points: mark.points.map((point) => ({ ...point })),
      })),
    );
    selectedMark = undefined;
    markDrag = undefined;
    render();
  }
  function undoHistory() {
    if (historyIndex <= 0) return;
    restoreHistory(historyIndex - 1);
    status.textContent = "Undid last change";
  }
  function redoHistory() {
    if (historyIndex >= history.length - 1) return;
    restoreHistory(historyIndex + 1);
    status.textContent = "Redid change";
  }

  const undo = makeButton("Undo", undoHistory);
  undo.title = "Undo (Ctrl/⌘+Z)";
  const redo = makeButton("Redo", redoHistory);
  redo.title = "Redo (Ctrl/⌘+Shift+Z)";
  const clear = makeButton("Clear", () => {
    if (!marks.length) return;
    marks.length = 0;
    selectedMark = undefined;
    markDrag = undefined;
    pushHistory();
    render();
    status.textContent = "Annotations cleared. Undo to restore.";
  });
  clear.title = "Remove all annotations";
  toolbar.append(undo, redo, clear);
  if (toolbarParent) toolbarParent.append(toolbar);
  else canvas.insertAdjacentElement("beforebegin", toolbar);
  if (toolbarParent) toolbarParent.append(objectList);
  else canvas.insertAdjacentElement("beforebegin", objectList);
  canvas.style.touchAction = "none";
  canvas.style.cursor = "default";

  const drawMark = (ctx: CanvasContext, mark: Mark) => {
    const first = mark.points[0];
    const last = mark.points[mark.points.length - 1];
    if (!first || !last) return;
    ctx.save();
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    ctx.lineWidth = Math.max(2, canvas.width / 300);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (mark.tool === "pen") {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const point of mark.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    } else if (mark.tool === "rectangle") {
      ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    } else if (mark.tool === "arrow") {
      const angle = Math.atan2(last.y - first.y, last.x - first.x);
      const head = Math.max(10, canvas.width / 35);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(last.x, last.y);
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - head * Math.cos(angle - Math.PI / 6),
        last.y - head * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(
        last.x - head * Math.cos(angle + Math.PI / 6),
        last.y - head * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
    } else if (mark.tool === "mask") {
      ctx.fillStyle = mark.color;
      ctx.fillRect(first.x, first.y, last.x - first.x, last.y - first.y);
      ctx.strokeStyle = "rgba(255,255,255,.78)";
      ctx.lineWidth = Math.max(1, canvas.width / 900);
      ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    } else if (mark.tool === "blur") {
      ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    } else if (mark.text) {
      ctx.font = `600 ${textFontSize()}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(mark.text, first.x, first.y, canvas.width - first.x);
    }
    ctx.restore();
  };
  const drawRedactions = (ctx: CanvasContext, source: Mark[]) => {
    for (const mark of source) {
      if (mark.tool === "mask") {
        drawMark(ctx, mark);
        continue;
      }
      if (mark.tool !== "blur") continue;
      const first = mark.points[0], last = mark.points.at(-1);
      if (!first || !last) continue;
      const left = Math.max(0, Math.floor(Math.min(first.x, last.x)));
      const top = Math.max(0, Math.floor(Math.min(first.y, last.y)));
      const right = Math.min(canvas.width, Math.ceil(Math.max(first.x, last.x)));
      const bottom = Math.min(canvas.height, Math.ceil(Math.max(first.y, last.y)));
      const width = right - left, height = bottom - top;
      if (width < 2 || height < 2) continue;
      try {
        const transform = ctx.getTransform();
        const blurRadius = Math.max(6, canvas.width / 240);
        const padding = blurRadius * 3;
        const sourceLeft = Math.max(0, left - padding), sourceTop = Math.max(0, top - padding);
        const sourceRight = Math.min(canvas.width, right + padding), sourceBottom = Math.min(canvas.height, bottom + padding);
        const sourceWidth = sourceRight - sourceLeft, sourceHeight = sourceBottom - sourceTop;
        const sampleScale = Math.min(1, Math.sqrt(1_048_576 / (sourceWidth * sourceHeight)));
        const scratch = blurSurface;
        const scratchWidth = Math.max(1, Math.ceil(sourceWidth * sampleScale));
        const scratchHeight = Math.max(1, Math.ceil(sourceHeight * sampleScale));
        if (scratch.width !== scratchWidth) scratch.width = scratchWidth;
        if (scratch.height !== scratchHeight) scratch.height = scratchHeight;
        const scratchContext = scratch.getContext("2d");
        if (!scratchContext) continue;
        scratchContext.clearRect(0, 0, scratch.width, scratch.height);
        scratchContext.drawImage(
          ctx.canvas as CanvasImageSource,
          Math.round(sourceLeft * transform.a + sourceTop * transform.c + transform.e),
          Math.round(sourceLeft * transform.b + sourceTop * transform.d + transform.f),
          Math.ceil(sourceWidth),
          Math.ceil(sourceHeight),
          0,
          0,
          scratch.width,
          scratch.height,
        );
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.filter = `blur(${blurRadius}px)`;
        ctx.drawImage(scratch, sourceLeft, sourceTop, sourceWidth, sourceHeight);
        ctx.filter = "none";
        ctx.fillStyle = mark.color;
        ctx.globalAlpha = 0.2;
        ctx.fillRect(left, top, width, height);
        ctx.restore();
      } catch {
        // The solid mask remains available if a browser cannot allocate a blur region.
      }
    }
  };
  const drawSpotlight = (ctx: CanvasContext, mark: Mark) => {
    if (!bitmap && !options.drawBase) return;
    const first = mark.points[0];
    const last = mark.points.at(-1);
    if (!first || !last) return;
    const left = Math.min(first.x, last.x);
    const top = Math.min(first.y, last.y);
    const width = Math.abs(last.x - first.x);
    const height = Math.abs(last.y - first.y);
    ctx.save();
    ctx.fillStyle = "rgba(16, 18, 22, 0.58)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    if (options.drawBase) options.drawBase(ctx);
    else if (bitmap) ctx.drawImage(bitmap, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = mark.color;
    ctx.lineWidth = Math.max(2, canvas.width / 300);
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
  };
  const textFontSize = () => Math.max(14, canvas.width / 45);
  const textBounds = (ctx: CanvasContext, mark: Mark) => {
    const point = mark.points[0];
    if (!point || !mark.text) return undefined;
    ctx.font = `600 ${textFontSize()}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const width = Math.min(
      ctx.measureText(mark.text).width,
      canvas.width - point.x,
    );
    return {
      x: point.x - 4,
      y: point.y - 3,
      width: width + 8,
      height: textFontSize() * 1.45,
    };
  };
  const markBounds = (mark: Mark) => {
    const xs = mark.points.map(({ x }) => x);
    const ys = mark.points.map(({ y }) => y);
    const pad = Math.max(6, canvas.width / 300);
    const left = Math.min(...xs) - pad;
    const top = Math.min(...ys) - pad;
    const right = Math.max(...xs) + pad;
    const bottom = Math.max(...ys) + pad;
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const resizable = (mark: Mark) => ["rectangle", "blur", "mask", "spotlight"].includes(mark.tool);
  const boxCorners = (mark: Mark): Point[] => {
    const xs = mark.points.map(({ x }) => x), ys = mark.points.map(({ y }) => y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  };
  const resizeCornerAt = (point: Point, mark: Mark) => {
    if (!resizable(mark)) return undefined;
    const radius = Math.max(10, canvas.width / 220);
    return boxCorners(mark).findIndex((corner) => Math.abs(point.x - corner.x) <= radius && Math.abs(point.y - corner.y) <= radius);
  };
  const drawResizeHandles = (ctx: CanvasContext, mark: Mark) => {
    if (!resizable(mark)) return;
    const size = Math.max(8, canvas.width / 250);
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(1.5, canvas.width / 1000);
    for (const corner of boxCorners(mark)) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#2878e8";
      ctx.beginPath();
      ctx.rect(corner.x - size / 2, corner.y - size / 2, size, size);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  };
  const markAt = (point: Point) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const displayedWidth = Math.max(1, canvas.getBoundingClientRect().width);
    const tolerance = Math.max(12, (10 * canvas.width) / displayedWidth);
    const ordered = [
      ...marks.filter((mark) => mark.tool === "blur" || mark.tool === "mask").reverse(),
      ...marks.filter((mark) => mark.tool !== "blur" && mark.tool !== "mask").reverse(),
    ];
    for (const mark of ordered) {
      const bounds =
        mark.tool === "text" ? textBounds(ctx, mark) : markBounds(mark);
      if (
        bounds &&
        point.x >= bounds.x - tolerance &&
        point.x <= bounds.x + bounds.width + tolerance &&
        point.y >= bounds.y - tolerance &&
        point.y <= bounds.y + bounds.height + tolerance
      )
        return mark;
    }
    return undefined;
  };
  let restoreObjectListFocus = false;
  const renderObjectList = () => {
    objectList.hidden = marks.length === 0;
    objectListSummary.textContent = `Annotations · ${marks.length}`;
    objectListItems.replaceChildren();
    let selectedButton: HTMLButtonElement | undefined;
    marks.forEach((mark, index) => {
      const item = document.createElement("li"),
        button = document.createElement("button"),
        point = mark.points[0]!,
        description = mark.tool === "text" ? `Text: ${mark.text ?? "empty"}` : `${mark.tool[0]!.toUpperCase()}${mark.tool.slice(1)}`;
      button.type = "button";
      button.textContent = `${index + 1}. ${description}`;
      button.setAttribute("aria-label", `${description}, at ${Math.round(point.x)}, ${Math.round(point.y)}`);
      button.setAttribute("aria-pressed", String(mark === selectedMark));
      button.addEventListener("click", () => {
        selectedMark = mark;
        color = mark.color;
        colorInput.value = color;
        restoreObjectListFocus = true;
        selectTool("select");
        render();
        if (mark.tool === "text") startText(mark.points[0]!, undefined, mark);
        else status.textContent = `${description} selected. Press Delete to remove it; drag to move${resizable(mark) ? " or resize from a corner handle" : ""}.`;
      });
      item.append(button);
      objectListItems.append(item);
      if (mark === selectedMark) selectedButton = button;
    });
    if (restoreObjectListFocus) {
      restoreObjectListFocus = false;
      selectedButton?.focus({ preventScroll: true });
    }
  };
  const render = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (options.drawBase) options.drawBase(ctx);
    else if (bitmap) ctx.drawImage(bitmap, 0, 0);
    const spotlight =
      [...marks].reverse().find((mark) => mark.tool === "spotlight") ??
      (draft?.tool === "spotlight" ? draft : undefined);
    if (spotlight) drawSpotlight(ctx, spotlight);
    for (const mark of marks)
      if (mark.tool !== "spotlight" && mark !== editingMark) drawMark(ctx, mark);
    if (draft && draft !== spotlight) drawMark(ctx, draft);
    drawRedactions(ctx, marks.filter((mark) => mark !== editingMark));
    if (selectedMark && selectedMark !== editingMark) {
      const bounds =
        selectedMark.tool === "text"
          ? textBounds(ctx, selectedMark)
          : markBounds(selectedMark);
      if (bounds) {
        ctx.save();
        ctx.strokeStyle = "#2878e8";
        ctx.lineWidth = Math.max(2, canvas.width / 700);
        ctx.setLineDash([
          Math.max(4, canvas.width / 180),
          Math.max(3, canvas.width / 260),
        ]);
        ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
        ctx.restore();
      }
    }
    options.drawForeground?.(ctx);
    if (selectedMark && selectedMark !== editingMark) drawResizeHandles(ctx, selectedMark);
    renderObjectList();
    undo.disabled = options.canUndo ? !options.canUndo() : historyIndex === 0;
    redo.disabled = options.canRedo ? !options.canRedo() : historyIndex >= history.length - 1;
    clear.disabled = marks.length === 0;
  };
  const pointFromEvent = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return clientToCanvasPoint(event.clientX, event.clientY, rect, canvas.width, canvas.height) ?? { x: 0, y: 0 };
  };
  const startText = (point: Point, event?: Event, existing?: Mark) => {
    textEditor?.blur();
    const editor = document.createElement("input");
    textEditor = editor;
    editingMark = existing;
    editor.type = "text";
    editor.maxLength = 120;
    editor.value = existing?.text ?? "";
    editor.setAttribute("aria-label", "Type annotation on screenshot");
    editor.className = "canvas-text-input";
    editor.autocomplete = "off";
    editor.spellcheck = false;
    editor.style.color = existing?.color ?? color;
    editor.dataset.annotationColor = existing?.color ?? color;
    const stage = textEditorParent ?? canvas.parentElement;
    if (!stage) return;
    const imageRect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    editor.style.left = `${imageRect.left - stageRect.left + (point.x / canvas.width) * imageRect.width}px`;
    editor.style.top = `${imageRect.top - stageRect.top + (point.y / canvas.height) * imageRect.height}px`;
    editor.style.fontSize = `${Math.max(12, (textFontSize() * imageRect.width) / canvas.width)}px`;
    editor.style.maxWidth = `${Math.max(16, ((canvas.width - point.x) * imageRect.width) / canvas.width)}px`;
    const fitEditorWidth = () => {
      const fontSize = Math.max(12, (textFontSize() * imageRect.width) / canvas.width);
      editor.style.width = `${Math.min(parseFloat(editor.style.maxWidth), Math.max(fontSize * 1.4, editor.scrollWidth))}px`;
    };
    editor.style.width = `${Math.max(16, parseFloat(editor.style.fontSize))}px`;
    editor.addEventListener("input", fitEditorWidth);
    stage.append(editor);
    fitEditorWidth();
    if (existing) render();
    const commit = () => {
      if (textEditor !== editor) return;
      textEditor = undefined;
      editingMark = undefined;
      const text = editor.value.trim();
      editor.remove();
      if (text) {
        if (existing) {
          const markColor = editor.dataset.annotationColor ?? color;
          const changed = existing.text !== text || existing.color !== markColor;
          existing.text = text;
          existing.color = markColor;
          selectedMark = existing;
          if (changed) pushHistory();
        } else {
          const mark: Mark = { tool: "text", color: editor.dataset.annotationColor ?? color, points: [point], text };
          marks.push(mark);
          selectedMark = mark;
          pushHistory();
        }
        render();
        status.textContent = existing ? "Text updated" : "Text added";
      } else if (existing) {
        const index = marks.indexOf(existing);
        if (index >= 0) marks.splice(index, 1);
        selectedMark = undefined;
        if (index >= 0) pushHistory();
        render();
        status.textContent = "Text removed";
      }
    };
    editor.addEventListener("keydown", (key) => {
      if (key.key === "Enter") {
        key.preventDefault();
        key.stopPropagation();
        editor.blur();
      } else if (key.key === "Escape") {
        key.preventDefault();
        key.stopPropagation();
        textEditor = undefined;
        editingMark = undefined;
        editor.remove();
        render();
        status.textContent = "Text editing canceled";
      }
    });
    editor.addEventListener("blur", commit, { once: true });
    editor.focus();
    event?.preventDefault();
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = pointFromEvent(event);
    if (selectedMark) {
      const resizeCorner = resizeCornerAt(point, selectedMark);
      if (resizeCorner !== undefined && resizeCorner >= 0) {
        const corners = boxCorners(selectedMark);
        markDrag = {
          mark: selectedMark,
          start: point,
          origins: selectedMark.points.map((origin) => ({ ...origin })),
          moved: false,
          resizeCorner,
          anchor: corners[(resizeCorner + 2) % 4],
        };
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    const hit = markAt(point);
    if (hit && !event.altKey) {
      selectedMark = hit;
      color = hit.color;
      colorInput.value = color;
      markDrag = {
        mark: hit,
        start: point,
        origins: hit.points.map((origin) => ({ ...origin })),
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      render();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (tool === "select") {
      selectedMark = undefined;
      render();
      return;
    }
    if (tool === "text") {
      startText(point, event);
      event.stopImmediatePropagation();
      return;
    }
    selectedMark = undefined;
    draft = { tool, color: tool === "mask" || tool === "blur" ? toolColors[tool]! : color, points: [point] };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (markDrag) {
      event.stopImmediatePropagation();
      const point = pointFromEvent(event);
      if (markDrag.resizeCorner !== undefined && markDrag.anchor) {
        const anchor = markDrag.anchor;
        let x = Math.max(0, Math.min(canvas.width, point.x));
        let y = Math.max(0, Math.min(canvas.height, point.y));
        if (Math.abs(x - anchor.x) < 2) x = Math.max(0, Math.min(canvas.width, anchor.x + (markDrag.resizeCorner === 0 || markDrag.resizeCorner === 3 ? -2 : 2)));
        if (Math.abs(y - anchor.y) < 2) y = Math.max(0, Math.min(canvas.height, anchor.y + (markDrag.resizeCorner < 2 ? -2 : 2)));
        if (Math.hypot(point.x - markDrag.start.x, point.y - markDrag.start.y) > 1) markDrag.moved = true;
        if (markDrag.moved) {
          markDrag.mark.points = [{ ...anchor }, { x, y }];
          render();
        }
        return;
      }
      let dx = point.x - markDrag.start.x;
      let dy = point.y - markDrag.start.y;
      if (Math.hypot(dx, dy) > 2) markDrag.moved = true;
      if (markDrag.moved) {
        const xs = markDrag.origins.map(({ x }) => x);
        const ys = markDrag.origins.map(({ y }) => y);
        dx = Math.max(
          -Math.min(...xs),
          Math.min(canvas.width - Math.max(...xs), dx),
        );
        dy = Math.max(
          -Math.min(...ys),
          Math.min(canvas.height - Math.max(...ys), dy),
        );
        markDrag.mark.points = markDrag.origins.map((origin) => ({
          x: origin.x + dx,
          y: origin.y + dy,
        }));
        render();
      }
      return;
    }
    if (!draft && selectedMark) {
      const corner = resizeCornerAt(pointFromEvent(event), selectedMark);
      if (corner !== undefined && corner >= 0) {
        canvas.style.cursor = corner % 2 === 0 ? "nwse-resize" : "nesw-resize";
        return;
      }
      if (tool === "select") canvas.style.cursor = "default";
    }
    if (!draft) return;
    event.stopImmediatePropagation();
    if (draft.points.length >= 4000 && draft.tool === "pen") return;
    const point = pointFromEvent(event);
    if (draft.tool === "pen") draft.points.push(point);
    else draft.points = [draft.points[0]!, point];
    render();
  });
  const finishMark = (event: PointerEvent) => {
    if (markDrag) {
      event.stopImmediatePropagation();
      const gesture = markDrag;
      markDrag = undefined;
      if (!gesture.moved && gesture.mark.tool === "text")
        startText(gesture.origins[0]!, event, gesture.mark);
      else if (gesture.moved) {
        pushHistory();
        status.textContent = gesture.resizeCorner !== undefined ? `${gesture.mark.tool} resized` : `${gesture.mark.tool === "pen" ? "Drawing" : gesture.mark.tool} moved`;
      } else
        status.textContent = `${gesture.mark.tool} selected. Drag to move${resizable(gesture.mark) ? " or resize from a corner handle" : ""}.`;
      return;
    }
    if (!draft) return;
    event.stopImmediatePropagation();
    if (draft.points.length > 1) {
      if (draft.tool === "spotlight") {
        for (let index = marks.length - 1; index >= 0; index--)
          if (marks[index]!.tool === "spotlight") marks.splice(index, 1);
      }
      marks.push(draft);
      pushHistory();
      status.textContent = `${draft.tool === "pen" ? "Drawing" : draft.tool} added`;
    }
    draft = undefined;
    render();
  };
  canvas.addEventListener("pointerup", finishMark);
  canvas.addEventListener("pointercancel", () => {
    if (markDrag) {
      markDrag.mark.points = markDrag.origins.map((origin) => ({ ...origin }));
      markDrag = undefined;
    }
    if (draft) draft = undefined;
    status.textContent = "Change canceled";
    render();
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      textEditor ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    ) return;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === "z") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.shiftKey) (options.onRedo ?? redoHistory)();
        else (options.onUndo ?? undoHistory)();
      } else if (key === "y") {
        event.preventDefault();
        event.stopImmediatePropagation();
        (options.onRedo ?? redoHistory)();
      }
      return;
    }
    if (event.altKey || event.repeat) return;
    const tools: Record<string, AnnotationTool> = {
      v: "select",
      p: "pen",
      a: "arrow",
      r: "rectangle",
      t: "text",
      s: "spotlight",
    };
    const nextTool = tools[key];
    if (nextTool) {
      event.preventDefault();
      event.stopPropagation();
      selectTool(nextTool);
    } else if ((event.key === "Delete" || event.key === "Backspace") && selectedMark) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const index = marks.indexOf(selectedMark);
      if (index >= 0) {
        marks.splice(index, 1);
        selectedMark = undefined;
        pushHistory();
        render();
        status.textContent = "Annotation removed";
      }
    }
  };

  const renderForExport = (context: CanvasContext) => {
    if (options.drawBase) options.drawBase(context);
    else if (bitmap) context.drawImage(bitmap, 0, 0);
    const spotlight = [...marks].reverse().find((mark) => mark.tool === "spotlight");
    if (spotlight) drawSpotlight(context, spotlight);
    for (const mark of marks) if (mark.tool !== "spotlight") drawMark(context, mark);
    drawRedactions(context, marks);
  };
  document.addEventListener("keydown", onKeyDown, true);

  if (options.drawBase) render();
  else {
    const encoded = basePng.slice(basePng.indexOf(",") + 1);
    const source = new Blob(
      [Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))],
      { type: "image/png" },
    );
    void createImageBitmap(source)
      .then((image) => {
        if (disposed) {
          image.close();
          return;
        }
        bitmap = image;
        render();
      })
      .catch(() => {
        status.textContent =
          "Annotation tools could not initialize. You can still copy or download the image.";
      });
  }

  const dispose = (() => {
    disposed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    textEditor?.remove();
    textEditor = undefined;
    bitmap?.close();
    bitmap = undefined;
    blurSurface.width = blurSurface.height = 1;
    toolbar.remove();
    objectList.remove();
  }) as AnnotationAttachment;
  dispose.render = render;
  dispose.renderForExport = renderForExport;
  dispose.undo = undoHistory;
  dispose.redo = redoHistory;
  return dispose;
}
