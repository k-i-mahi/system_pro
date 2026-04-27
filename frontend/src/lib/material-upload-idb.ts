const DB_NAME = 'copilot-material-uploads-v1';
const STORE = 'pending';
const DB_VERSION = 1;

function idbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export type MaterialPendingRecord = {
  uploadKey: string;
  userId: string;
  courseId: string;
  topicId: string;
  fileName: string;
  mimeType: string;
  buffer: ArrayBuffer;
};

function openDb(): Promise<IDBDatabase> {
  if (!idbSupported()) {
    return Promise.reject(new Error('indexedDB unavailable'));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'uploadKey' });
      }
    };
  });
}

export async function idbPutPending(row: MaterialPendingRecord): Promise<void> {
  if (!idbSupported()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb write failed'));
    tx.objectStore(STORE).put(row);
  });
  db.close();
}

export async function idbDeletePending(uploadKey: string): Promise<void> {
  if (!idbSupported()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'));
    tx.objectStore(STORE).delete(uploadKey);
  });
  db.close();
}

export async function idbGetPending(uploadKey: string): Promise<MaterialPendingRecord | null> {
  if (!idbSupported()) return null;
  const db = await openDb();
  const row = await new Promise<MaterialPendingRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(uploadKey);
    req.onsuccess = () => resolve((req.result as MaterialPendingRecord) ?? null);
    req.onerror = () => reject(req.error ?? new Error('idb get failed'));
  });
  db.close();
  return row;
}

export async function idbListPendingForUser(userId: string): Promise<MaterialPendingRecord[]> {
  if (!idbSupported()) return [];
  const db = await openDb();
  const rows = await new Promise<MaterialPendingRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as MaterialPendingRecord[]) ?? [];
      resolve(all.filter((r) => r.userId === userId));
    };
    req.onerror = () => reject(req.error ?? new Error('idb list failed'));
  });
  db.close();
  return rows;
}

export async function idbClearAllForUser(userId: string): Promise<void> {
  if (!idbSupported()) return;
  const rows = await idbListPendingForUser(userId);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb clear failed'));
    const store = tx.objectStore(STORE);
    for (const r of rows) {
      store.delete(r.uploadKey);
    }
  });
  db.close();
}
