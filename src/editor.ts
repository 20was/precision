import { showPreview } from "./overlay";
import { openHandoffDb, type HandoffMeta } from "./shared/handoff";
import { showCompositionEditor } from "./composition-editor";
import type { CompositionItem } from "./shared/composition";

const closeEditor = () => {
  void chrome.runtime.sendMessage({ type: "closeEditor" }).catch(() => window.close());
};

const showFailure = (message: string) => {
  document.body.replaceChildren();
  const main = document.createElement("main"),
    heading = document.createElement("h1"),
    detail = document.createElement("p"),
    button = document.createElement("button");
  heading.textContent = "Capture unavailable";
  detail.textContent = message;
  button.type = "button";
  button.textContent = "Close tab";
  button.addEventListener("click", closeEditor);
  main.append(heading, detail, button);
  document.body.append(main);
};

async function takeCapture(id: string) {
  const db = await openHandoffDb();
  try {
    const result = await new Promise<{ meta?: HandoffMeta; chunks: Array<{ id: string; index: number; value: string }> }>((resolve, reject) => {
      const tx = db.transaction(["captures", "chunks"], "readonly"),
        metaRequest = tx.objectStore("captures").get(id),
        chunkRequest = tx.objectStore("chunks").index("capture").getAll(id),
        chunks: Array<{ id: string; index: number; value: string }> = [];
      let meta: HandoffMeta | undefined;
      metaRequest.onsuccess = () => (meta = metaRequest.result as HandoffMeta | undefined);
      chunkRequest.onsuccess = () => chunks.push(...(chunkRequest.result as typeof chunks));
      tx.oncomplete = () => {
        void (async () => {
          if (!meta) return resolve({ chunks });
          await new Promise<void>((done, fail) => {
            const cleanup = db.transaction(["captures", "chunks"], "readwrite"),
              store = cleanup.objectStore("chunks"),
              cursor = store.index("capture").openKeyCursor(IDBKeyRange.only(id));
            cleanup.objectStore("captures").delete(id);
            cursor.onsuccess = () => {
              const item = cursor.result;
              if (!item) return;
              store.delete(item.primaryKey);
              item.continue();
            };
            cleanup.oncomplete = () => done();
            cleanup.onerror = () => fail(cleanup.error ?? new Error("Could not clear the temporary screenshot."));
          });
          resolve({ meta, chunks });
        })().catch(reject);
      };
      tx.onerror = () => reject(tx.error ?? new Error("Could not read the local screenshot."));
      tx.onabort = () => reject(tx.error ?? new Error("Screenshot handoff was interrupted."));
    });
    if (!result.meta || result.meta.created < Date.now() - 10 * 60_000)
      throw new Error("This temporary capture expired. Capture the page again.");
    const { meta, chunks } = result;
    if (meta.kind !== "image" && meta.kind !== "composition")
      throw new Error("The capture type is invalid.");
    if (meta.count > 1024) throw new Error("The capture is too large to open safely.");
    if (meta.kind === "image" && (meta.width <= 0 || meta.height <= 0 || meta.width * meta.height > 40_000_000))
      throw new Error("The screenshot is too large to open safely.");
    if (meta.kind === "composition" && (!meta.itemCount || meta.itemCount > 24))
      throw new Error("The composition data is invalid.");
    if (chunks.length !== meta.count)
      throw new Error("The screenshot transfer was incomplete. Capture the page again.");
    chunks.sort((a, b) => a.index - b.index);
    if (chunks.some((chunk, index) => chunk.index !== index || typeof chunk.value !== "string"))
      throw new Error("The screenshot data was incomplete. Capture the page again.");
    const encoded = chunks.map((chunk) => chunk.value).join("");
    if (encoded.length > 110_000_000) throw new Error("The capture is too large to open safely.");
    if (meta.kind === "image") return { meta, payload: `data:image/png;base64,${encoded}` };
    const binary = atob(encoded),
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return { meta, payload: new TextDecoder().decode(bytes) };
  } finally {
    db.close();
  }
}

void (async () => {
  let decodedBitmaps: ImageBitmap[] = [];
  try {
    const id = new URL(location.href).searchParams.get("id");
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("The capture link is invalid.");
    const { meta, payload } = await takeCapture(id);
    if (meta.kind === "image") {
      showPreview(payload, meta.width, meta.height, closeEditor);
      return;
    }
    const raw: unknown = JSON.parse(payload);
    if (!Array.isArray(raw) || raw.length !== meta.itemCount || raw.length < 1 || raw.length > 24)
      throw new Error("The composition data is invalid.");
    const items = raw.map((value): CompositionItem => {
      if (!value || typeof value !== "object") throw new Error("The composition data is invalid.");
      const item = value as Record<string, unknown>;
      if (
        typeof item.png !== "string" ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(item.png) ||
        !Number.isInteger(item.width) || typeof item.width !== "number" || item.width <= 0 || item.width > 32768 ||
        !Number.isInteger(item.height) || typeof item.height !== "number" || item.height <= 0 || item.height > 32768 ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(String(item.label))
      ) throw new Error("The composition contains invalid image data.");
      return { png: item.png, width: item.width, height: item.height, label: item.label as string };
    });
    const totalPixels = items.reduce((total, item) => total + item.width * item.height, 0);
    if (totalPixels > 32_000_000) throw new Error("This composition is too large to edit safely.");
    decodedBitmaps = await Promise.all(items.map(async (item) => {
      const rawPng = atob(item.png.slice(item.png.indexOf(",") + 1)),
        bytes = Uint8Array.from(rawPng, (character) => character.charCodeAt(0));
      return createImageBitmap(new Blob([bytes], { type: "image/png" }));
    }));
    if (decodedBitmaps.some((bitmap, index) => bitmap.width !== items[index]!.width || bitmap.height !== items[index]!.height))
      throw new Error("An element image did not match its capture dimensions.");
    showCompositionEditor(items.map(({ width, height, label }) => ({ width, height, label })), decodedBitmaps, closeEditor);
    decodedBitmaps = [];
  } catch (error) {
    for (const bitmap of decodedBitmaps) bitmap.close();
    showFailure(error instanceof Error ? error.message : "Could not open the captured image.");
  }
})();
