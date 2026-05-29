// Per-book reading progress mirrored to localStorage so we can resume from
// the last position even when the server is unreachable.

const PREFIX = 'mislibros.progress.';

export function saveProgressLocal(bookId, cfi, percentage) {
  try {
    localStorage.setItem(PREFIX + bookId, JSON.stringify({
      cfi, percentage, at: Date.now(),
    }));
  } catch { /* swallow */ }
}

export function getProgressLocal(bookId) {
  try {
    const raw = localStorage.getItem(PREFIX + bookId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
