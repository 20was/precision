export type AnnotationTool =
  "select" | "pen" | "arrow" | "rectangle" | "text" | "spotlight";
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

  const marks: Mark[] = [];
  const history: Mark[][] = [[]];
  let historyIndex = 0;
  const toolButtons = new Map<AnnotationTool, HTMLButtonElement>();
  let tool: AnnotationTool = "select";
  let color = "#e5484d";
  let draft: Mark | undefined;
  let bitmap: ImageBitmap | undefined;
  let disposed = false;
  let textEditor: HTMLInputElement | undefined;
  let editingMark: Mark | undefined;
  let selectedMark: Mark | undefined;
  let markDrag:
    { mark: Mark; start: Point; origins: Point[]; moved: boolean } | undefined;

  const iconPaths: Record<string, string> = {
    Select: "M5 3l14 11-7 1-3 6L5 3Z",
    Pen: "m12 19 7-7 3 3-7 7H12v-3ZM18 13l-3-3 2-2a2 2 0 0 1 3 3l-2 2ZM4 20l4.5-1.2L5.2 15.5 4 20Z",
    Arrow: "M5 12h14m-6-6 6 6-6 6",
    Rectangle: "M4 5h16v14H4z",
    Text: "M5 5h14M12 5v14",
    Spotlight:
      "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
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
    options.onToolChange?.(tool);
    for (const [name, button] of toolButtons)
      button.setAttribute("aria-pressed", String(name === tool));
    canvas.style.cursor =
      tool === "text" ? "text" : tool === "select" ? "default" : "crosshair";
    status.textContent =
      tool === "select"
        ? "Click a mark to select it. Drag inside its outline to move; click text to edit. Choose a drawing tool to add marks."
        : tool === "text"
        ? "Text: click the image and type directly. Press Enter to place. Hold Alt/Option to add over a mark."
          : tool === "spotlight"
            ? "Spotlight: drag to keep an area bright and dim the rest. Hold Alt/Option to overlap marks."
            : `${next === "pen" ? "Pen" : next === "arrow" ? "Arrow" : "Rectangle"}: drag on the image. Hold Alt/Option to draw over existing marks.`;
  };
  for (const [name, label] of [
    ["select", "Select"],
    ["pen", "Pen"],
    ["arrow", "Arrow"],
    ["rectangle", "Rectangle"],
    ["text", "Text"],
    ["spotlight", "Spotlight"],
  ] as const) {
    const button = makeButton(label, () => selectTool(name), name === tool);
    const shortcut: Record<AnnotationTool, string> = {
      select: "V",
      pen: "P",
      arrow: "A",
      rectangle: "R",
      text: "T",
      spotlight: "S",
    };
    button.title = `${label} (${shortcut[name]})`;
    toolButtons.set(name, button);
    toolbar.append(button);
  }
  selectTool(tool);

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = color;
  colorInput.setAttribute("aria-label", "Annotation color");
  colorInput.title = "Annotation color";
  colorInput.addEventListener("input", () => {
    color = colorInput.value;
    if (textEditor) {
      textEditor.style.color = color;
      textEditor.dataset.annotationColor = color;
    }
  });
  toolbar.append(colorInput);

  function pushHistory() {
    history.splice(historyIndex + 1);
    history.push(
      marks.map((mark) => ({
        ...mark,
        points: mark.points.map((point) => ({ ...point })),
      })),
    );
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
    } else if (mark.text) {
      ctx.font = `600 ${textFontSize()}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(mark.text, first.x, first.y, canvas.width - first.x);
    }
    ctx.restore();
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
  const markAt = (point: Point) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const displayedWidth = Math.max(1, canvas.getBoundingClientRect().width);
    const tolerance = Math.max(12, (10 * canvas.width) / displayedWidth);
    for (const mark of [...marks].reverse()) {
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
    undo.disabled = options.canUndo ? !options.canUndo() : historyIndex === 0;
    redo.disabled = options.canRedo ? !options.canRedo() : historyIndex >= history.length - 1;
    clear.disabled = marks.length === 0;
  };
  const pointFromEvent = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return clientToCanvasPoint(event.clientX, event.clientY, rect, canvas.width, canvas.height) ?? { x: 0, y: 0 };
  };
  const startText = (point: Point, event: PointerEvent, existing?: Mark) => {
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
    event.preventDefault();
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = pointFromEvent(event);
    const hit = markAt(point);
    if (hit && !event.altKey) {
      selectedMark = hit;
      markDrag = {
        mark: hit,
        start: point,
        origins: hit.points.map((origin) => ({ ...origin })),
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      render();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (tool === "select") {
      selectedMark = undefined;
      render();
      return;
    }
    if (tool === "text") {
      startText(point, event);
      event.stopPropagation();
      return;
    }
    selectedMark = undefined;
    draft = { tool, color, points: [point] };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (markDrag) {
      const point = pointFromEvent(event);
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
    if (!draft) return;
    if (draft.points.length >= 4000 && draft.tool === "pen") return;
    const point = pointFromEvent(event);
    if (draft.tool === "pen") draft.points.push(point);
    else draft.points = [draft.points[0]!, point];
    render();
  });
  const finishMark = (event: PointerEvent) => {
    if (markDrag) {
      const gesture = markDrag;
      markDrag = undefined;
      if (!gesture.moved && gesture.mark.tool === "text")
        startText(gesture.origins[0]!, event, gesture.mark);
      else if (gesture.moved) {
        pushHistory();
        status.textContent = `${gesture.mark.tool === "pen" ? "Drawing" : gesture.mark.tool} moved`;
      } else
        status.textContent = `${gesture.mark.tool} selected. Drag to move.`;
      return;
    }
    if (!draft) return;
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
    if (textEditor) return;
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
    } else if (event.key === "Delete" && selectedMark) {
      event.preventDefault();
      event.stopPropagation();
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
    toolbar.remove();
  }) as AnnotationAttachment;
  dispose.render = render;
  dispose.renderForExport = renderForExport;
  dispose.undo = undoHistory;
  dispose.redo = redoHistory;
  return dispose;
}
