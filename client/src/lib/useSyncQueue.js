import { useEffect } from 'react';
import { api } from './api.js';
import { listUnsynced, markSynced } from './offlineProgress.js';

// On startup, online events, and tab focus, push any reading-progress saves
// that didn't make it to the server (e.g. offline reads) and mark them synced.
async function flush() {
  const pending = listUnsynced();
  if (pending.length === 0) return;
  for (const p of pending) {
    try {
      await api.putProgress(p.bookId, p.cfi, p.percentage);
      markSynced(p.bookId);
    } catch {
      return; // network down or server error — bail; we'll retry next event
    }
  }
}

export function useSyncQueue() {
  useEffect(() => {
    flush();
    const onOnline = () => flush();
    const onFocus = () => flush();
    const onVisible = () => { if (document.visibilityState === 'visible') flush(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
