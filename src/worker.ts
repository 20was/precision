import { cropPixels } from "./shared/geometry";
import {
  failure,
  isCapture,
  record,
  type CaptureMessage,
} from "./shared/protocol";
import { transition, type Phase } from "./shared/session";
interface Session {
  id: string;
  tab: number;
  window: number;
  document?: string;
  phase: Phase;
  expires: number;
}
const sessions = new Map<number, Session>();
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
}
async function active(s: Session, requireFocus = true) {
  if (sessions.get(s.tab) !== s || s.expires < Date.now())
    throw new Error("Capture expired. Open Precision and try again.");
  const [tab, window] = await Promise.all([
    chrome.tabs.get(s.tab),
    chrome.windows.get(s.window),
  ]);
  if (
    !tab.active ||
    tab.windowId !== s.window ||
    (requireFocus && !window.focused)
  )
    throw new Error(
      "Keep the selected tab and browser window active while capturing.",
    );
}
async function begin(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (
    !tab.url ||
    !/^https?:\/\//.test(tab.url) ||
    /^https:\/\/(chromewebstore.google.com|chrome.google.com\/webstore)/.test(
      tab.url,
    )
  )
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
    expires: Date.now() + 120_000,
  };
  sessions.set(tabId, s);
  try {
    await active(s, false);
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    s.document = result[0]?.documentId;
    await chrome.tabs.sendMessage(
      tabId,
      { type: "begin", session: s.id },
      { documentId: s.document, frameId: 0 },
    );
    setTimeout(() => {
      if (sessions.get(tabId) === s) void stop(s);
    }, 120_000);
  } catch (error) {
    await stop(s);
    throw error;
  }
}
async function capture(s: Session, message: CaptureMessage) {
  if (capturing || Date.now() - lastCapture < 600)
    throw new Error(
      "Another capture is finishing. Please try again in a moment.",
    );
  s.phase = transition(s.phase, "capturing");
  capturing = true;
  s.expires = Date.now() + 15_000;
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
    s.phase = transition(s.phase, "complete");
    sessions.delete(s.tab);
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
    Number.isInteger(message.tab)
  ) {
    await begin(message.tab as number);
    return { ok: true, value: undefined };
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
    return { ok: true };
  }
  if (isCapture(message)) {
    try {
      const value = await capture(s, message);
      return { ok: true, value };
    } finally {
      if (sessions.get(s.tab) === s) sessions.delete(s.tab);
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
