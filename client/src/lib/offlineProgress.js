// Per-book reading progress mirrored to localStorage so we can resume from
// the last position even when the server is unreachable, and replay saves
// once the connection comes back.

const PREFIX = 'mislibros.progress.';

export function saveProgressLocal(bookId, cfi, percentage, { synced = false } = {}) {
  try {
    localStorage.setItem(PREFIX + bookId, JSON.stringify({
      cfi, percentage, at: Date.now(), synced,
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

export function markSynced(bookId) {
  const p = getProgressLocal(bookId);
  if (!p) return;
  try {
    localStorage.setItem(PREFIX + bookId, JSON.stringify({ ...p, synced: true }));
  } catch { /* swallow */ }
}

export function listUnsynced() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const p = JSON.parse(localStorage.getItem(key));
      if (p && !p.synced && p.cfi) {
        out.push({ bookId: Number(key.slice(PREFIX.length)), ...p });
      }
    } catch { /* skip */ }
  }
  return out;
}
