import { cropPixels } from "./shared/geometry";
import {
  failure,
  isCapture,
  record,
  type CaptureMessage,
} from "./shared/protocol";
import { transition, type Phase } from "./shared/session";
import { isSupportedPageUrl } from "./shared/page-url";
import { deleteHandoff, saveHandoffChunk, saveHandoffMeta } from "./shared/handoff";
interface Session {
  id: string;
  tab: number;
  window: number;
  document?: string;
  phase: Phase;
  mode: "element" | "fullPage" | "compose";
  expires: number;
}
const sessions = new Map<number, Session>();
const visibleCaptures = new Set<number>();
let capturing = false,
  lastCapture = 0;
const extensionUrl = (path: string) => chrome.runtime.getURL(path);
async function stop(s: Session) {
  sessions.delete(s.tab);
  await chrome.tabs
    .sendMessage(
      s.tab,
      { type: "cancelSelection", session: s.id },
      { frameId: 0 },
    )
    .catch(() => {});
  if (s.mode !== "element") await deleteHandoff(s.id).catch(() => {});
}
async function active(s: Session) {
  if (sessions.get(s.tab) !== s || s.expires < Date.now())
    throw new Error("Capture expired. Open Precision and try again.");
  const tab = await chrome.tabs.get(s.tab);
  if (!tab.active || tab.windowId !== s.window)
    throw new Error(
      "Keep the selected page active in its browser window while capturing.",
    );
}
async function begin(tabId: number, mode: "element" | "fullPage" | "compose") {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isSupportedPageUrl(tab.url))
    throw new Error(
      "This page cannot be selected. Open a regular http or https webpage; browser pages, the Web Store and PDFs are unsupported.",
    );
  const old = sessions.get(tabId);
  if (old) await stop(old);
  const s: Session = {
    id: crypto.randomUUID(),
    tab: tabId,
    window: tab.windowId,
    phase: "selecting",
    mode,
    expires: Date.now() + (mode === "element" ? 120_000 : 15 * 60_000),
  };
  sessions.set(tabId, s);
  try {
    await active(s);
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    s.document = result[0]?.documentId;
    await chrome.tabs.sendMessage(
      tabId,
      { type: "begin", session: s.id, mode },
      { documentId: s.document, frameId: 0 },
    );
    setTimeout(() => {
      if (sessions.get(tabId) === s) void stop(s);
    }, mode === "element" ? 120_000 : 15 * 60_000);
  } catch (error) {
    await stop(s);
    throw error;
  }
}
async function captureVisibleViewport(tabId: number) {
  if (visibleCaptures.has(tabId)) throw new Error("A visible-area capture is already starting.");
  visibleCaptures.add(tabId);
  let ownsCapture = false;
  const id = crypto.randomUUID();
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !isSupportedPageUrl(tab.url))
      throw new Error("This page cannot be captured. Open a regular http or https webpage; browser pages, the Web Store and PDFs are unsupported.");
    const previous = sessions.get(tabId);
    if (previous) await stop(previous);
    if (!tab.active)
      throw new Error("The selected page is no longer the active tab. Open Precision on the page you want to capture and try again.");
    while (capturing || Date.now() - lastCapture < 600)
      await new Promise((resolve) => setTimeout(resolve, Math.max(20, 600 - (Date.now() - lastCapture))));
    const readyTab = await chrome.tabs.get(tabId);
    if (!readyTab.active || readyTab.windowId !== tab.windowId)
      throw new Error("The active page changed before capture. Try again.");
    capturing = true;
    ownsCapture = true;
    lastCapture = Date.now();
    const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const current = await chrome.tabs.get(tabId);
    if (!current.active || current.windowId !== tab.windowId)
      throw new Error("The active page changed during capture. Try again.");
    const prefix = "data:image/png;base64,";
    if (!data.startsWith(prefix)) throw new Error("The browser did not return a PNG image.");
    const encoded = data.slice(prefix.length);
    if (!encoded.length || encoded.length > 110_000_000)
      throw new Error("This viewport image is too large to process safely. Try reducing the browser window size.");
    const headerBytes = atob(encoded.slice(0, 32));
    if (headerBytes.length < 24 || headerBytes.slice(0, 8) !== "\x89PNG\r\n\x1a\n")
      throw new Error("The browser returned an invalid PNG image.");
    const header = new DataView(Uint8Array.from(headerBytes, (char) => char.charCodeAt(0)).buffer);
    const width = header.getUint32(16), height = header.getUint32(20);
    if (!width || !height || width > 32768 || height > 32768 || width * height > 40_000_000)
      throw new Error("This viewport image is too large to process safely. Try reducing the browser window size.");
    const chunkSize = 96 * 1024, count = Math.ceil(encoded.length / chunkSize);
    if (!count || count > 1024) throw new Error("The viewport image is too large to transfer safely.");
    for (let index = 0; index < count; index++)
      await saveHandoffChunk(id, index, encoded.slice(index * chunkSize, Math.min(encoded.length, (index + 1) * chunkSize)));
    await saveHandoffMeta({ id, kind: "image", width, height, count, created: Date.now() });
    const stillActive = await chrome.tabs.get(tabId);
    if (!stillActive.active || stillActive.windowId !== tab.windowId)
      throw new Error("The active page changed before the capture was ready. Try again.");
    try {
      await chrome.tabs.create({ url: extensionUrl(`editor.html?id=${encodeURIComponent(id)}`) });
    } catch (error) {
      await deleteHandoff(id).catch(() => {});
      throw error;
    }
  } catch (error) {
    await deleteHandoff(id).catch(() => {});
    throw error;
  } finally {
    if (ownsCapture) capturing = false;
    visibleCaptures.delete(tabId);
  }
}
async function captureFrame(s: Session) {
  if (s.mode !== "fullPage" || sessions.get(s.tab) !== s)
    throw new Error("This full-page capture has expired. Start again.");
  while (capturing || Date.now() - lastCapture < 520) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(20, 520 - (Date.now() - lastCapture))));
    await active(s);
  }
  capturing = true;
  try {
    await active(s);
    lastCapture = Date.now();
    const image = await chrome.tabs.captureVisibleTab(s.window, { format: "png" });
    await active(s);
    if (sessions.get(s.tab) !== s)
      throw new Error("Capture cancelled. Start again when ready.");
    return { image };
  } finally {
    capturing = false;
  }
}
async function capture(s: Session, message: CaptureMessage) {
  const composing = s.mode === "compose" && message.delivery === "composeItem";
  if (!composing && s.mode !== "element")
    throw new Error("This capture action is not valid for the active mode.");
  while (capturing || Date.now() - lastCapture < 600) {
    if (!composing)
      throw new Error("Another capture is finishing. Please try again in a moment.");
    await new Promise((resolve) => setTimeout(resolve, Math.max(20, 600 - (Date.now() - lastCapture))));
    await active(s);
  }
  if (!composing) s.phase = transition(s.phase, "capturing");
  capturing = true;
  s.expires = Date.now() + (composing ? 15 * 60_000 : 15_000);
  let bitmap: ImageBitmap | undefined;
  try {
    await active(s);
    lastCapture = Date.now();
    const started = performance.now();
    const data = await chrome.tabs.captureVisibleTab(s.window, {
      format: "png",
    });
    const captured = performance.now();
    await active(s);
    const verified = await chrome.tabs.sendMessage(
      s.tab,
      { type: "verify", session: s.id },
      { documentId: s.document, frameId: 0 },
    );
    if (!verified?.ok)
      throw new Error(
        "The page moved or changed during capture. Try again with the page still.",
      );
    // Decode without network/fetch; CSP deliberately blocks all connections.
    const raw = atob(data.slice(data.indexOf(",") + 1));
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    const header = new DataView(bytes.buffer);
    if (
      bytes.length < 24 ||
      header.getUint32(16) * header.getUint32(20) > 40_000_000
    )
      throw new Error("Screenshot is too large. Use a smaller browser window.");
    bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const crop = cropPixels(
      message.rect,
      message.viewport,
      bitmap.width,
      bitmap.height,
    );
    const canvas = new OffscreenCanvas(crop.width, crop.height),
      ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error(
        "Image processing is unavailable. Restart the browser and try again.",
      );
    ctx.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    bitmap.close();
    bitmap = undefined;
    const blob = await canvas.convertToBlob({ type: "image/png" });
    canvas.width = canvas.height = 1;
    const output = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < output.length; i += 32768)
      binary += String.fromCharCode(...output.subarray(i, i + 32768));
    await active(s);
    const png = `data:image/png;base64,${btoa(binary)}`;
    if (composing) s.expires = Date.now() + 15 * 60_000;
    else {
      s.phase = transition(s.phase, "complete");
      sessions.delete(s.tab);
    }
    performance.clearMeasures();
    performance.measure("precision:screenshot", {
      start: started,
      end: captured,
    });
    performance.measure("precision:crop-export-handoff", {
      start: captured,
      end: performance.now(),
    });
    console.info(
      "Precision capture ms",
      Math.round(performance.now() - started),
      "screenshot ms",
      Math.round(captured - started),
      "crop/export ms",
      Math.round(performance.now() - captured),
      "output",
      crop.width,
      crop.height,
    );
    return { delivery: message.delivery, png, width: crop.width, height: crop.height };
  } finally {
    bitmap?.close();
    capturing = false;
  }
}
async function route(message: unknown, sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || !record(message))
    throw new Error("Invalid request.");
  if (
    message.type === "start" &&
    sender.url === extensionUrl("popup.html") &&
    Number.isInteger(message.tab) &&
    (message.mode === "element" || message.mode === "visible" || message.mode === "fullPage" || message.mode === "compose")
  ) {
    if (message.mode === "visible") await captureVisibleViewport(message.tab as number);
    else await begin(message.tab as number, message.mode);
    return { ok: true, value: undefined };
  }
  if (
    message.type === "closeEditor" &&
    sender.url?.startsWith(`${extensionUrl("editor.html")}?id=`) &&
    sender.frameId === 0 &&
    sender.tab?.id !== undefined
  ) {
    await chrome.tabs.remove(sender.tab.id);
    return { ok: true };
  }
  const s =
    sender.tab?.id === undefined ? undefined : sessions.get(sender.tab.id);
  if (
    !s ||
    sender.frameId !== 0 ||
    sender.documentId !== s.document ||
    message.session !== s.id
  )
    throw new Error("This selection expired. Open Precision and try again.");
  if (message.type === "cancel") {
    s.phase = transition(s.phase, "cancelled");
    sessions.delete(s.tab);
    if (s.mode !== "element") await deleteHandoff(s.id);
    return { ok: true };
  }
  if (message.type === "captureFrame") {
    const value = await captureFrame(s);
    return { ok: true, value };
  }
  if (
    message.type === "fullPageChunk" &&
    s.mode === "fullPage" &&
    typeof message.index === "number" &&
    message.index === Math.floor(message.index) &&
    message.index >= 0 &&
    message.index < 1024 &&
    typeof message.chunk === "string" &&
    message.chunk.length > 0 &&
    message.chunk.length <= 131072
  ) {
    s.expires = Date.now() + 15 * 60_000;
    await active(s);
    await saveHandoffChunk(s.id, message.index, message.chunk);
    return { ok: true };
  }
  if (
    message.type === "fullPageComplete" &&
    s.mode === "fullPage" &&
    Number.isInteger(message.width) &&
    Number.isInteger(message.height) &&
    Number.isInteger(message.count) &&
    typeof message.width === "number" &&
    typeof message.height === "number" &&
    typeof message.count === "number" &&
    message.width > 0 && message.height > 0 &&
    message.width * message.height <= 40_000_000 &&
    message.count > 0 && message.count <= 1024
  ) {
    s.expires = Date.now() + 15 * 60_000;
    await saveHandoffMeta({
      id: s.id,
      kind: "image",
      width: message.width,
      height: message.height,
      count: message.count,
      created: Date.now(),
    });
    await active(s);
    s.phase = transition(s.phase, "capturing");
    s.phase = transition(s.phase, "complete");
    sessions.delete(s.tab);
    try {
      await chrome.tabs.create({ url: extensionUrl(`editor.html?id=${encodeURIComponent(s.id)}`) });
    } catch (error) {
      await deleteHandoff(s.id).catch(() => {});
      throw error;
    }
    return { ok: true };
  }
  if (
    message.type === "compositionChunk" &&
    s.mode === "compose" &&
    typeof message.index === "number" &&
    message.index === Math.floor(message.index) &&
    message.index >= 0 && message.index < 1024 &&
    typeof message.chunk === "string" &&
    message.chunk.length > 0 &&
    message.chunk.length <= 131072
  ) {
    s.expires = Date.now() + 15 * 60_000;
    await active(s);
    await saveHandoffChunk(s.id, message.index, message.chunk);
    return { ok: true };
  }
  if (
    message.type === "compositionComplete" &&
    s.mode === "compose" &&
    Number.isInteger(message.itemCount) &&
    typeof message.itemCount === "number" && message.itemCount > 0 && message.itemCount <= 24 &&
    Number.isInteger(message.count) &&
    typeof message.count === "number" && message.count > 0 && message.count <= 1024
  ) {
    await saveHandoffMeta({
      id: s.id,
      kind: "composition",
      width: 0,
      height: 0,
      count: message.count,
      itemCount: message.itemCount,
      created: Date.now(),
    });
    await active(s);
    s.phase = transition(s.phase, "capturing");
    s.phase = transition(s.phase, "complete");
    sessions.delete(s.tab);
    try {
      await chrome.tabs.create({ url: extensionUrl(`editor.html?id=${encodeURIComponent(s.id)}`) });
    } catch (error) {
      await deleteHandoff(s.id).catch(() => {});
      throw error;
    }
    return { ok: true };
  }
  if (
    isCapture(message) &&
    ((s.mode === "element" && message.delivery !== "composeItem") ||
      (s.mode === "compose" && message.delivery === "composeItem"))
  ) {
    try {
      const value = await capture(s, message);
      return { ok: true, value };
    } finally {
      if (s.mode === "element" && sessions.get(s.tab) === s) sessions.delete(s.tab);
    }
  }
  throw new Error("Invalid capture request.");
}
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  void route(message, sender).then(reply, (error) => reply(failure(error)));
  return true;
});
chrome.tabs.onRemoved.addListener((tab) => {
  const s = sessions.get(tab);
  if (s) void stop(s);
});
chrome.tabs.onUpdated.addListener((tab, change) => {
  const s = sessions.get(tab);
  if (s && (change.status === "loading" || change.url)) void stop(s);
});
chrome.tabs.onActivated.addListener((info) => {
  for (const s of sessions.values())
    if (s.window === info.windowId && s.tab !== info.tabId) void stop(s);
});
chrome.windows.onFocusChanged.addListener((id) => {
  for (const s of sessions.values()) if (s.window !== id) void stop(s);
});
