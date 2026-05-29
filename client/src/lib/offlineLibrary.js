// localStorage snapshot of the last successful library list, so the library
// page still renders when the server is unreachable.

const KEY = 'mislibros.libraryCache';

export function saveCachedLibrary(books) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), books }));
  } catch { /* quota, private mode, etc — swallow */ }
}

export function getCachedLibrary() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.books) ? parsed : null;
  } catch {
    return null;
  }
}
