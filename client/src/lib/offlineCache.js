// Stores book files (EPUB/PDF as ArrayBuffer) in IndexedDB so they can be
// reopened with no network. Keyed by bookId as string.

const DB_NAME = 'mislibros';
const STORE = 'books';
const DB_VERSION = 1;

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrapRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putBookFile(bookId, buffer) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  return wrapRequest(tx.objectStore(STORE).put(buffer, String(bookId)));
}

export async function getBookFile(bookId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    return await wrapRequest(tx.objectStore(STORE).get(String(bookId)));
  } catch {
    return null;
  }
}

export async function listCachedBookIds() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const keys = await wrapRequest(tx.objectStore(STORE).getAllKeys());
    return new Set(keys.map((k) => Number(k)));
  } catch {
    return new Set();
  }
}

export async function deleteBookFile(bookId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    return await wrapRequest(tx.objectStore(STORE).delete(String(bookId)));
  } catch { /* swallow */ }
}
