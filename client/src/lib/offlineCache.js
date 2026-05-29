// Stores book files (EPUB/PDF as ArrayBuffer) and cover images (Blob) in
// IndexedDB so they can be displayed/opened with no network.

const DB_NAME = 'mislibros';
const STORE_BOOKS = 'books';
const STORE_COVERS = 'covers';
const DB_VERSION = 2;

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) db.createObjectStore(STORE_BOOKS);
      if (!db.objectStoreNames.contains(STORE_COVERS)) db.createObjectStore(STORE_COVERS);
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

async function tx(storeName, mode, fn) {
  try {
    const db = await openDB();
    const t = db.transaction(storeName, mode);
    return await fn(t.objectStore(storeName));
  } catch {
    return null;
  }
}

export async function putBookFile(bookId, buffer) {
  return tx(STORE_BOOKS, 'readwrite', (s) => wrapRequest(s.put(buffer, String(bookId))));
}
export async function getBookFile(bookId) {
  return tx(STORE_BOOKS, 'readonly', (s) => wrapRequest(s.get(String(bookId))));
}
export async function listCachedBookIds() {
  const keys = await tx(STORE_BOOKS, 'readonly', (s) => wrapRequest(s.getAllKeys()));
  return new Set((keys || []).map((k) => Number(k)));
}
export async function deleteBookFile(bookId) {
  return tx(STORE_BOOKS, 'readwrite', (s) => wrapRequest(s.delete(String(bookId))));
}

export async function putCover(bookId, blob) {
  return tx(STORE_COVERS, 'readwrite', (s) => wrapRequest(s.put(blob, String(bookId))));
}
export async function getCover(bookId) {
  return tx(STORE_COVERS, 'readonly', (s) => wrapRequest(s.get(String(bookId))));
}
