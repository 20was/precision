import { Overlay, showError, showNotice, showPreview } from "./overlay";
import { bounds, targetAt, parentTarget, childTarget } from "./target";
import { sameGeometry, type Rect, type Viewport } from "./shared/geometry";
import { record, token, type Result } from "./shared/protocol";
import type { CompositionItem } from "./shared/composition";

// Re-injection replaces only this extension's previous listener and active selector.
const scope = globalThis as typeof globalThis & {
  __precisionDispose?: () => void;
  __precisionPreviewDispose?: () => void;
};
scope.__precisionDispose?.();
scope.__precisionPreviewDispose?.();
let disposeSelection = () => {};
function start(session: string, mode: "element" | "compose" = "element") {
  disposeSelection();
  const previouslyFocused = document.activeElement;
  const overlay = new Overlay({
      cancel: () => cancel(),
      preview: () => mode === "compose" ? void finishComposition() : void capture("preview"),
      copy: () => void capture(mode === "compose" ? "composeItem" : "copy"),
      undoAdd: () => {
        if (mode !== "compose" || busy || done) return;
        compositionItems.pop();
        overlay.setCompositionCount(compositionItems.length);
      },
    }, mode),
    controller = new AbortController();
  const compositionItems: CompositionItem[] = [];
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
    if (disposeSelection === cancel) disposeSelection = () => {};
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
  const timer = setTimeout(cancel, mode === "compose" ? 15 * 60_000 : 120_000);
  const canAddToComposition = (width: number, height: number) => {
    const sizes = [...compositionItems, { width, height }],
      canvasWidth = Math.max(...sizes.map((item) => item.width)) + 96,
      canvasHeight = sizes.reduce((sum, item) => sum + item.height, 96) + Math.max(0, sizes.length - 1) * 28;
    return canvasWidth <= 32767 && canvasHeight <= 32767 && canvasWidth * canvasHeight <= 32_000_000;
  };
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
  const finishComposition = async () => {
    if (mode !== "compose" || busy || done || compositionItems.length === 0) return;
    busy = true;
    overlay.hide();
    try {
      const payload = new TextEncoder().encode(JSON.stringify(compositionItems));
      if (payload.length > 80_000_000)
        throw new Error("This composition is too large to open safely. Remove an element and try again.");
      const chunkBytes = 96 * 1024,
        count = Math.ceil(payload.length / chunkBytes);
      if (count > 1024)
        throw new Error("This composition is too large to transfer safely. Remove an element and try again.");
      for (let index = 0; index < count; index++) {
        if (done) return;
        const part = payload.subarray(index * chunkBytes, Math.min(payload.length, (index + 1) * chunkBytes));
        let binary = "";
        for (let offset = 0; offset < part.length; offset += 32768)
          binary += String.fromCharCode(...part.subarray(offset, offset + 32768));
        const reply = (await chrome.runtime.sendMessage({
          type: "compositionChunk",
          session,
          index,
          chunk: btoa(binary),
        })) as Result;
        if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : "Composition transfer failed.");
      }
      if (done) return;
      const reply = (await chrome.runtime.sendMessage({
        type: "compositionComplete",
        session,
        count,
        itemCount: compositionItems.length,
      })) as Result;
      if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : "Could not open the composition editor.");
      cleanup();
    } catch (error) {
      if (!done) {
        notifyCancel();
        cleanup();
        showError(error instanceof Error ? error.message : "Could not open the composition editor.");
      }
    } finally {
      if (!done && mode === "compose") {
        busy = false;
        overlay.setCompositionCount(compositionItems.length);
        schedule();
      }
    }
  };
  const capture = async (delivery: "preview" | "copy" | "composeItem" = "preview") => {
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
            delivery === "composeItem" ? 30_000 : 15_000,
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
      } else if (delivery === "composeItem") {
        const value = response.value;
        if (value?.delivery !== "composeItem" || typeof value.png !== "string" || !Number.isInteger(value.width) || !Number.isInteger(value.height))
          throw new Error("The element could not be added. Try selecting it again.");
        if (compositionItems.length >= 24)
          throw new Error("A composition can contain up to 24 elements.");
        if (!canAddToComposition(value.width!, value.height!))
          throw new Error("This composition is too large to edit safely. Remove an element or choose a smaller one.");
        compositionItems.push({ png: value.png, width: value.width!, height: value.height!, label: target.tagName.toLowerCase() });
        overlay.setCompositionCount(compositionItems.length);
      } else {
        const value = response.value;
        if (value?.delivery !== "preview" || typeof value.png !== "string" || !Number.isInteger(value.width) || !Number.isInteger(value.height))
          throw new Error("The image preview could not be prepared. Please capture again.");
        cleanup();
        scope.__precisionPreviewDispose = showPreview(value.png, value.width!, value.height!, () => { scope.__precisionPreviewDispose = undefined; });
      }
    } catch (error) {
      if (!done) {
        if (mode !== "compose") notifyCancel();
        overlay.setCopyBusy(false);
        const message = error instanceof Error ? error.message : "Capture failed.";
        if (mode === "compose") overlay.setMessage(message);
        else showError(message);
      }
    } finally {
      if (mode === "compose" && delivery === "composeItem" && !done) {
        busy = false;
        overlay.setCopyBusy(false);
        overlay.setCompositionCount(compositionItems.length);
        schedule();
      } else cleanup();
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
        void capture(mode === "compose" ? "composeItem" : "preview");
      }
    });
  listen("keydown", (e) => {
    const k = e as KeyboardEvent;
    if (!["Escape", "Enter", "ArrowUp", "ArrowDown"].includes(k.key)) return;
    if (k.key !== "Escape" && overlay.isControlFocused()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (k.key === "Escape") cancel();
    else if (k.key === "Enter") void capture(mode === "compose" ? "composeItem" : "preview");
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
  overlay.focusSelection();
  pointer = true;
  schedule();
}
function startFullPage(session: string) {
  let cancelled = false,
    finished = false,
    restored = false;
  const startX = scrollX,
    startY = scrollY,
    host = document.createElement("precision-full-page-progress"),
    root = host.attachShadow({ mode: "closed" }),
    style = document.createElement("style"),
    panel = document.createElement("div"),
    heading = document.createElement("strong"),
    detail = document.createElement("span"),
    track = document.createElement("div"),
    bar = document.createElement("i"),
    cancelButton = document.createElement("button"),
    controller = new AbortController();
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:auto!important;background:transparent!important;";
  style.textContent = `:host{color-scheme:dark}*{box-sizing:border-box}.panel{pointer-events:auto;position:fixed;top:18px;left:50%;transform:translateX(-50%);display:grid;grid-template-columns:1fr auto;gap:3px 16px;min-width:270px;max-width:calc(100vw - 24px);padding:12px 14px;background:#242421;color:#f5f4ef;border:1px solid #55554e;border-radius:9px;box-shadow:0 5px 24px #0005;font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.title{font-size:13px;font-weight:600}.detail{color:#c4c3bb}.track{grid-column:1/-1;height:3px;background:#4c4c45;border-radius:3px;overflow:hidden}.bar{display:block;height:100%;width:0;background:#d6f268;transition:width 120ms linear}button{grid-column:2;grid-row:1/3;align-self:center;border:1px solid #68685f;border-radius:5px;padding:7px 10px;background:#30302b;color:#f5f4ef;font:inherit;cursor:pointer}button:hover{background:#44443e}button:focus-visible{outline:2px solid #fff;outline-offset:2px}`;
  panel.className = "panel";
  heading.className = "title";
  heading.textContent = "Capturing full page";
  detail.className = "detail";
  detail.textContent = "Preparing page…";
  track.className = "track";
  bar.className = "bar";
  track.append(bar);
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => cancel());
  panel.append(heading, detail, cancelButton, track);
  root.append(style, panel);
  document.documentElement.append(host);
  const setProgress = (done: number, total: number) => {
    detail.textContent = `Scrolling and capturing · ${Math.min(100, Math.floor((done / total) * 100))}%`;
    bar.style.width = `${Math.min(100, (done / total) * 100)}%`;
  };
  const cancel = () => {
    if (finished) return;
    cancelled = true;
    void chrome.runtime.sendMessage({ type: "cancel", session }).catch(() => {});
  };
  const assertLive = () => {
    if (cancelled || finished) throw new Error("Full-page capture cancelled.");
  };
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const restorePage = async () => {
    if (restored) return;
    window.scrollTo({ top: startY, left: startX, behavior: "instant" });
    await nextFrame();
    await nextFrame();
    restored = true;
  };
  const settledScroll = async (destination: number) => {
    const behavior: ScrollBehavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    window.scrollTo({ top: destination, left: startX, behavior });
    let last = -1,
      stable = 0;
    const until = performance.now() + 3500;
    while (performance.now() < until && stable < 3) {
      assertLive();
      await nextFrame();
      const current = scrollY;
      stable = Math.abs(current - last) < 0.25 ? stable + 1 : 0;
      last = current;
    }
    if (stable < 3) throw new Error("Page scrolling did not settle. Try again after page animations finish.");
  };
  const detectStickyTop = (viewportWidth: number, viewportHeight: number) => {
    const previousPointerEvents = host.style.pointerEvents,
      previousVisibility = panel.style.visibility;
    panel.style.visibility = "hidden";
    host.style.setProperty("pointer-events", "none", "important");
    let height = 0;
    try {
      const xs = [0.08, 0.5, 0.92].map((ratio) => Math.max(1, Math.min(viewportWidth - 1, viewportWidth * ratio))),
        ys = [1, 12, 28, 48, 72, 100, 132].filter((value) => value < viewportHeight);
      for (const x of xs) for (const y of ys) {
        for (const hit of document.elementsFromPoint(x, y)) {
          if (hit === host || host.contains(hit)) continue;
          for (let element: Element | null = hit; element && element !== document.documentElement; element = element.parentElement) {
            const style = getComputedStyle(element),
              rect = element.getBoundingClientRect(),
              stickyTop = Number.parseFloat(style.top),
              anchoredAtTop = style.position === "fixed"
                ? rect.top <= 48
                : style.position === "sticky" && Number.isFinite(stickyTop)
                  ? rect.top <= stickyTop + 2
                  : false;
            if (
              anchoredAtTop && rect.bottom > 0 && rect.height <= viewportHeight * 0.28 &&
              rect.width >= viewportWidth * 0.5
            ) height = Math.max(height, rect.bottom);
          }
        }
      }
    } finally {
      host.style.setProperty("pointer-events", previousPointerEvents || "auto", "important");
      panel.style.visibility = previousVisibility || "visible";
    }
    return Math.max(0, Math.min(height, viewportHeight * 0.25));
  };
  const send = async (message: Record<string, unknown>, timeoutMs = 15000) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = (await Promise.race([
        chrome.runtime.sendMessage({ ...message, session }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Capture timed out. Try again with a shorter page.")), timeoutMs);
        }),
      ])) as Result<Record<string, unknown>>;
      if (!response?.ok) throw new Error(response && !response.ok ? response.error : "Capture interrupted. Try again.");
      return response.value ?? {};
    } finally {
      clearTimeout(timer);
    }
  };
  const run = async () => {
    let canvas: OffscreenCanvas | undefined,
      context: OffscreenCanvasRenderingContext2D | null = null;
    try {
      const visual = visualViewport;
      if (visual && (Math.abs(visual.scale - 1) > 0.001 || Math.abs(visual.offsetLeft) > 0.01 || Math.abs(visual.offsetTop) > 0.01))
        throw new Error("Pinch zoom is not supported for full-page capture. Reset pinch zoom and try again.");
      const viewportWidth = innerWidth,
        viewportHeight = innerHeight,
        doc = document.documentElement,
        body = document.body,
        pageWidth = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0),
        pageHeight = Math.max(doc.scrollHeight, body?.scrollHeight ?? 0, doc.clientHeight),
        maxY = Math.max(0, pageHeight - viewportHeight);
      if (pageWidth > viewportWidth + 2)
        throw new Error("This page scrolls horizontally. Full-page capture currently supports vertically scrolling pages.");
      if (viewportWidth <= 0 || viewportHeight <= 0 || pageHeight <= 0)
        throw new Error("The page has no visible capture area.");
      let covered = 0,
        scaleX = 0,
        scaleY = 0,
        bitmapWidth = 0,
        index = 0,
        topInset = 0;
      const imageSettleDeadline = performance.now() + 12_000;
      const settleVisibleImages = async () => {
        const visible = [...document.images].filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight &&
            rect.right > 0 && rect.left < viewportWidth && !!(image.currentSrc || image.getAttribute("src")) && !image.complete;
        });
        if (!visible.length) return;
        if (visible.length > 128 || performance.now() >= imageSettleDeadline)
          throw new Error("Images are still loading. Wait for the page to finish, then try again.");
        const remaining = Math.min(1_500, imageSettleDeadline - performance.now());
        let timer: ReturnType<typeof setTimeout> | undefined;
        const loaded = await Promise.race([
          Promise.allSettled(visible.map((image) => image.decode())).then(() => true),
          new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), remaining); }),
        ]).finally(() => clearTimeout(timer));
        if (!loaded) throw new Error("Images are still loading. Wait for the page to finish, then try again.");
      };
      while (covered < pageHeight) {
        assertLive();
        if (index >= 512) throw new Error("This page is too long to capture reliably. Try a shorter page.");
        const destination = index === 0 ? 0 : Math.min(maxY, Math.max(0, covered - topInset));
        if (Math.abs(scrollY - destination) > 0.5) await settledScroll(destination);
        await nextFrame();
        await settleVisibleImages();
        await nextFrame();
        if (innerWidth !== viewportWidth || innerHeight !== viewportHeight || Math.max(doc.scrollHeight, body?.scrollHeight ?? 0, doc.clientHeight) !== pageHeight)
          throw new Error("The page layout changed during capture. Try again when it is stable.");
        const actualY = scrollY;
        if (index === 0) topInset = detectStickyTop(viewportWidth, viewportHeight);
        const before = index === 0 ? 0 : Math.max(actualY + topInset, covered);
        let after = Math.min(pageHeight, actualY + viewportHeight);
        // At non-integer browser zoom, Chromium can clamp scrollY to a
        // fractional maximum that leaves a subpixel CSS remainder. Treat a
        // remainder of at most 2 CSS px as covered by the final viewport so
        // the stitch loop cannot spin forever at 99%.
        if (actualY >= maxY - 1 && pageHeight - after <= 2) after = pageHeight;
        if (before > covered + 1)
          throw new Error("The page moved while capturing. Try again when its layout is stable.");
        panel.style.visibility = "hidden";
        await nextFrame();
        await nextFrame();
        const result = await send({ type: "captureFrame" });
        panel.style.visibility = "visible";
        assertLive();
        if (typeof result.image !== "string" || !result.image.startsWith("data:image/png;base64,"))
          throw new Error("The browser did not return a screenshot. Try again.");
        const raw = atob(result.image.slice(result.image.indexOf(",") + 1)),
          bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0)),
          bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        try {
          if (!canvas) {
            scaleX = bitmap.width / viewportWidth;
            scaleY = bitmap.height / viewportHeight;
            bitmapWidth = bitmap.width;
            const outHeight = Math.ceil(pageHeight * scaleY);
            if (!(scaleX > 0 && scaleY > 0) || bitmap.width > 32767 || outHeight > 32767 || bitmap.width * outHeight > 40_000_000)
              throw new Error("This page is too large to capture safely. Use a smaller browser window or a shorter page.");
            canvas = new OffscreenCanvas(bitmap.width, outHeight);
            context = canvas.getContext("2d");
            if (!context) throw new Error("Image processing is unavailable. Restart the browser and try again.");
          } else if (bitmap.width !== bitmapWidth || Math.abs(bitmap.height / viewportHeight - scaleY) > 0.01) {
            throw new Error("The browser viewport changed during capture. Try again.");
          }
          const sourceY = Math.max(0, (before - actualY) * scaleY),
            sourceHeight = Math.min(bitmap.height - sourceY, (after - before) * scaleY),
            destY = before * scaleY;
          const destHeight = Math.min(canvas.height - destY, (after - before) * scaleY);
          if (sourceHeight > 0 && destY < canvas.height)
            context!.drawImage(bitmap, 0, sourceY, bitmap.width, sourceHeight, 0, destY, bitmap.width, destHeight);
        } finally {
          bitmap.close();
        }
        covered = Math.max(covered, after);
        setProgress(covered, pageHeight);
        index++;
      }
      assertLive();
      if (!canvas || covered < pageHeight - 1)
        throw new Error("Could not capture the complete page. Try again with a stable page.");
      await restorePage();
      detail.textContent = "Preparing image…";
      const blob = await canvas.convertToBlob({ type: "image/png" });
      canvas.width = canvas.height = 1;
      canvas = undefined;
      const chunkBytes = 96 * 1024,
        count = Math.ceil(blob.size / chunkBytes);
      if (blob.size > 80_000_000 || count > 1024)
        throw new Error("The resulting image is too large to transfer safely.");
      for (let index = 0; index < count; index++) {
        assertLive();
        const part = new Uint8Array(await blob.slice(index * chunkBytes, Math.min(blob.size, (index + 1) * chunkBytes)).arrayBuffer());
        let binary = "";
        for (let i = 0; i < part.length; i += 32768)
          binary += String.fromCharCode(...part.subarray(i, i + 32768));
        await send({ type: "fullPageChunk", index, chunk: btoa(binary) }, 30000);
        detail.textContent = `Preparing image · ${Math.floor(((index + 1) / count) * 100)}%`;
      }
      const height = Math.ceil(pageHeight * scaleY),
        width = bitmapWidth;
      assertLive();
      await send({ type: "fullPageComplete", width, height, count }, 30000);
      finished = true;
    } catch (error) {
      if (!cancelled) showError(error instanceof Error ? error.message : "Full-page capture failed.");
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      await restorePage();
      host.remove();
      controller.abort();
      finished = true;
      if (!cancelled) await chrome.runtime.sendMessage({ type: "cancel", session }).catch(() => {});
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  };
  const onBlur = () => cancel();
  window.addEventListener("keydown", onKey, { capture: true, signal: controller.signal });
  window.addEventListener("blur", onBlur, { signal: controller.signal });
  const onMessage = (message: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && record(message) && message.type === "cancelSelection" && message.session === session)
      cancel();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  controller.signal.addEventListener("abort", () => chrome.runtime.onMessage.removeListener(onMessage), { once: true });
  void run();
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
  if (message.mode === "fullPage") startFullPage(message.session);
  else start(message.session, message.mode === "compose" ? "compose" : "element");
  reply({ ok: true });
};
chrome.runtime.onMessage.addListener(listener);
scope.__precisionDispose = () => {
  disposeSelection();
  chrome.runtime.onMessage.removeListener(listener);
};
