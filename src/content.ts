import { Overlay, showError, showNotice, showPreview } from "./overlay";
import { bounds, targetAt, parentTarget, childTarget } from "./target";
import { sameGeometry, type Rect, type Viewport } from "./shared/geometry";
import { record, token, type Result } from "./shared/protocol";

// Re-injection replaces only this extension's previous listener and active selector.
const scope = globalThis as typeof globalThis & {
  __precisionDispose?: () => void;
  __precisionPreviewDispose?: () => void;
};
scope.__precisionDispose?.();
scope.__precisionPreviewDispose?.();
let disposeSelection = () => {};
function start(session: string) {
  disposeSelection();
  const previouslyFocused = document.activeElement;
  const overlay = new Overlay({
      cancel: () => cancel(),
      preview: () => void capture("preview"),
      copy: () => void capture("copy"),
    }),
    controller = new AbortController();
  let target: Element | null = null,
    raf = 0,
    x = innerWidth / 2,
    y = innerHeight / 2,
    pointer = false,
    busy = false,
    done = false;
  let captureRect: Rect | null = null,
    viewport: Viewport | null = null;
  const notifyCancel = () => {
    void chrome.runtime
      .sendMessage({ type: "cancel", session })
      .catch(() => {});
  };
  const cleanup = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    controller.abort();
    const restoreFocus = document.activeElement === overlay.host;
    overlay.remove();
    if (
      restoreFocus &&
      previouslyFocused instanceof HTMLElement &&
      previouslyFocused.isConnected
    )
      previouslyFocused.focus({ preventScroll: true });
    target = null;
  };
  const cancel = () => {
    notifyCancel();
    cleanup();
  };
  disposeSelection = cancel;
  const timer = setTimeout(cancel, 120_000);
  const measure = (): Viewport => {
    const v = visualViewport;
    if (
      v &&
      (Math.abs(v.scale - 1) > 0.001 ||
        Math.abs(v.offsetLeft) > 0.01 ||
        Math.abs(v.offsetTop) > 0.01)
    )
      throw new Error(
        "Pinch zoom is not supported. Reset pinch zoom and try again.",
      );
    return {
      width:
        (v?.width ?? innerWidth) +
        (innerWidth - document.documentElement.clientWidth),
      height:
        (v?.height ?? innerHeight) +
        (innerHeight - document.documentElement.clientHeight),
      scrollX,
      scrollY,
    };
  };
  const navigate = (direction: "parent" | "child") => {
    if (busy || done || !target) return;
    pointer = false;
    target =
      (direction === "parent" ? parentTarget(target) : childTarget(target)) ??
      target;
    schedule();
  };
  const draw = () => {
    raf = 0;
    if (done || busy) return;
    const previousTarget = target;
    if (pointer) target = overlay.hitTest(() => targetAt(x, y));
    const targetChanged = target !== previousTarget;
    overlay.show(target ? bounds(target) : null, target?.tagName.toLowerCase() ?? "", targetChanged ? x : undefined, targetChanged ? y : undefined);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  const capture = async (delivery: "preview" | "copy" = "preview") => {
    if (busy || done || !target) return;
    busy = true;
    try {
      overlay.hide();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (done) return;
      captureRect = bounds(target);
      viewport = measure();
      if (!captureRect)
        throw new Error("The element disappeared. Start a new capture.");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const response = (await Promise.race([
        chrome.runtime.sendMessage({
          type: "capture",
          session,
          rect: captureRect,
          viewport,
          delivery,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Capture timed out. Please try again.")),
            15_000,
          );
        }),
      ]).finally(() => clearTimeout(timeout))) as Result<{
        delivery?: string;
        png?: string;
        width?: number;
        height?: number;
      }>;
      if (!response?.ok)
        throw new Error(
          response && !response.ok
            ? response.error
            : "Capture interrupted. Open Precision and try again.",
        );
      if (delivery === "copy") {
        const value = response.value;
        if (value?.delivery !== "copy" || typeof value.png !== "string")
          throw new Error("The copied image could not be prepared. Try again.");
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
          throw new Error(
            "Direct image copy is unavailable on this page. Use Enter to open the preview and copy there.",
          );
        const encoded = value.png.slice(value.png.indexOf(",") + 1),
          raw = atob(encoded),
          bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([bytes], { type: "image/png" }),
          }),
        ]);
        cleanup();
        showNotice("Copied to clipboard");
      } else {
        const value = response.value;
        if (value?.delivery !== "preview" || typeof value.png !== "string" || !Number.isInteger(value.width) || !Number.isInteger(value.height))
          throw new Error("The image preview could not be prepared. Please capture again.");
        cleanup();
        scope.__precisionPreviewDispose = showPreview(value.png, value.width!, value.height!, () => { scope.__precisionPreviewDispose = undefined; });
      }
    } catch (error) {
      if (!done) {
        notifyCancel();
        overlay.setCopyBusy(false);
        showError(error instanceof Error ? error.message : "Capture failed.");
      }
    } finally {
      cleanup();
    }
  };
  const listen = (name: string, handler: EventListener) =>
    window.addEventListener(name, handler, {
      capture: true,
      signal: controller.signal,
    });
  listen("pointermove", (e) => {
    const p = e as PointerEvent;
    if (overlay.isToolbarReachPoint(p.clientX, p.clientY)) return;
    x = p.clientX;
    y = p.clientY;
    pointer = true;
    schedule();
  });
  // Stop pointerdown too: many controls act before click. Earlier page capture listeners cannot be undone.
  for (const name of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
  ])
    listen(name, (e) => {
      const mouse = e as MouseEvent;
      if (e.composedPath().includes(overlay.host)) return;
      if (!busy && overlay.isToolbarPoint(mouse.clientX, mouse.clientY)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (name === "click" && !busy) {
        const p = e as MouseEvent;
        target = overlay.hitTest(() => targetAt(p.clientX, p.clientY));
        void capture();
      }
    });
  listen("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (!["Escape", "Enter", "ArrowUp", "ArrowDown"].includes(k.key)) return;
    if (k.key !== "Escape" && overlay.isControlFocused()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (k.key === "Escape") cancel();
    else if (k.key === "Enter") void capture("preview");
    else if (!busy && target) {
      navigate(k.key === "ArrowUp" ? "parent" : "child");
    }
  });
  listen("scroll", () => {
    if (busy) cancel();
    else schedule();
  });
  listen("resize", cancel);
  listen("blur", (event) => {
    if (event.target === window) cancel();
  });
  listen("pagehide", cancel);
  listen("visibilitychange", () => {
    if (document.hidden) cancel();
  });
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (value: unknown) => void,
  ) => {
    if (
      sender.id !== chrome.runtime.id ||
      !record(message) ||
      message.session !== session
    )
      return;
    if (message.type === "cancelSelection") {
      cancel();
      reply({ ok: true });
    }
    if (message.type === "verify") {
      let valid: boolean;
      try {
        const r = target ? bounds(target) : null,
          v = measure();
        valid =
          !done &&
          !!r &&
          !!captureRect &&
          sameGeometry(r, captureRect) &&
          !!viewport &&
          Object.keys(v).every(
            (k) => v[k as keyof Viewport] === viewport?.[k as keyof Viewport],
          );
      } catch {
        valid = false;
      }
      reply({ ok: valid });
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  controller.signal.addEventListener(
    "abort",
    () => chrome.runtime.onMessage.removeListener(listener),
    { once: true },
  );
  overlay.host.tabIndex = -1;
  overlay.host.focus({ preventScroll: true });
  pointer = true;
  schedule();
}
const listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void,
) => {
  if (
    sender.id !== chrome.runtime.id ||
    !record(message) ||
    message.type !== "begin" ||
    !token(message.session)
  )
    return;
  start(message.session);
  reply({ ok: true });
};
chrome.runtime.onMessage.addListener(listener);
scope.__precisionDispose = () => {
  disposeSelection();
  chrome.runtime.onMessage.removeListener(listener);
};
