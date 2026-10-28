const DB_NAME = "precision-local-handoff";
const DB_VERSION = 1;
const META = "captures";
const CHUNKS = "chunks";

export interface HandoffMeta {
  id: string;
  kind: "image" | "composition";
  width: number;
  height: number;
  count: number;
  itemCount?: number;
  sourceUrl?: string;
  capturedAt?: number;
  created: number;
}

export function openHandoffDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META))
        db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const chunks = db.createObjectStore(CHUNKS, {
          keyPath: ["id", "index"],
        });
        chunks.createIndex("capture", "id");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local image handoff failed."));
  });
}

export async function saveHandoffChunk(
  id: string,
  index: number,
  value: string,
  created = Date.now(),
): Promise<void> {
  const db = await openHandoffDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNKS, "readwrite");
      tx.objectStore(CHUNKS).put({ id, index, value, created });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not save image data locally."));
      tx.onabort = () => reject(tx.error ?? new Error("Local image handoff was interrupted."));
    });
  } finally {
    db.close();
  }
}

export async function saveHandoffMeta(meta: HandoffMeta): Promise<void> {
  const db = await openHandoffDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META, "readwrite");
      tx.objectStore(META).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not finish local image handoff."));
    });
  } finally {
    db.close();
  }
}

export async function deleteHandoff(id: string): Promise<void> {
  const db = await openHandoffDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META, CHUNKS], "readwrite"),
        chunks = tx.objectStore(CHUNKS),
        cursor = chunks.index("capture").openKeyCursor(IDBKeyRange.only(id));
      tx.objectStore(META).delete(id);
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        chunks.delete(item.primaryKey);
        item.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not clear the temporary screenshot."));
    });
  } finally {
    db.close();
  }
}
