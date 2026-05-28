import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ePub from 'epubjs';
import styles from './reader.module.css';
import { api, bookFileUrl, getToken } from '../lib/api.js';
import { percent } from '../lib/format.js';

const SAVE_THROTTLE_MS = 3000;

export default function ReaderPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const viewportRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const lastSaveRef = useRef(0);
  const pendingRef = useRef(null);
  const saveTimerRef = useRef(null);
  const [pct, setPct] = useState(0);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let disposed = false;

    async function start() {
      try {
        const [progress, fileRes] = await Promise.all([
          api.getProgress(bookId),
          fetch(bookFileUrl(bookId), { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (!fileRes.ok) throw new Error('No se pudo cargar el libro');
        const buf = await fileRes.arrayBuffer();
        if (disposed) return;

        const book = ePub(buf);
        bookRef.current = book;
        const rendition = book.renderTo(viewportRef.current, {
          width: '100%', height: '100%', flow: 'paginated', spread: 'auto',
        });
        renditionRef.current = rendition;

        book.loaded.metadata.then((m) => { if (!disposed) setTitle(m?.title || ''); });

        await rendition.display(progress?.cfi || undefined);
        setLoading(false);

        rendition.on('relocated', (loc) => {
          const next = {
            cfi: loc.start.cfi,
            percentage: loc.start.percentage ?? 0,
          };
          setPct(next.percentage);
          pendingRef.current = next;
          scheduleSave();
        });

        // Keyboard navigation
        const onKey = (e) => {
          if (e.key === 'ArrowLeft') rendition.prev();
          else if (e.key === 'ArrowRight') rendition.next();
        };
        document.addEventListener('keydown', onKey);

        // Swipe navigation
        let touchX = null;
        const onTouchStart = (e) => { touchX = e.changedTouches[0].clientX; };
        const onTouchEnd = (e) => {
          if (touchX == null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) > 50) (dx < 0 ? rendition.next() : rendition.prev());
          touchX = null;
        };
        viewportRef.current.addEventListener('touchstart', onTouchStart);
        viewportRef.current.addEventListener('touchend', onTouchEnd);

        const onBeforeUnload = () => flushSave(true);
        window.addEventListener('beforeunload', onBeforeUnload);

        rendition.__cleanup = () => {
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('beforeunload', onBeforeUnload);
        };
      } catch (e) {
        setError(e.message);
        setLoading(false);
      }
    }

    start();
    return () => {
      disposed = true;
      flushSave(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (renditionRef.current?.__cleanup) renditionRef.current.__cleanup();
      try { renditionRef.current?.destroy(); } catch {}
      try { bookRef.current?.destroy(); } catch {}
    };
  }, [bookId]);

  function scheduleSave() {
    const now = Date.now();
    const elapsed = now - lastSaveRef.current;
    if (elapsed >= SAVE_THROTTLE_MS) flushSave(false);
    else if (!saveTimerRef.current) {
      saveTimerRef.current = setTimeout(() => flushSave(false), SAVE_THROTTLE_MS - elapsed);
    }
  }

  function flushSave(isUnload) {
    const data = pendingRef.current;
    if (!data) return;
    pendingRef.current = null;
    lastSaveRef.current = Date.now();
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }

    if (isUnload && navigator.sendBeacon) {
      const token = getToken();
      const blob = new Blob(
        [JSON.stringify({ cfi: data.cfi, percentage: data.percentage, _t: token })],
        { type: 'application/json' }
      );
      navigator.sendBeacon(`/api/books/${bookId}/progress`, blob);
      return;
    }
    api.putProgress(bookId, data.cfi, data.percentage).catch(() => {});
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')} aria-label="Volver">←</button>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.pct}>{percent(pct)}</span>
      </header>
      <div className={styles.viewport} ref={viewportRef}>
        {loading && <div className={styles.loading}>Cargando libro…</div>}
        {error && <div className={styles.loading} style={{ color: '#b00020' }}>{error}</div>}
        <button className={`${styles.navBtn} ${styles.navPrev}`} aria-label="Anterior"
          onClick={() => renditionRef.current?.prev()}>‹</button>
        <button className={`${styles.navBtn} ${styles.navNext}`} aria-label="Siguiente"
          onClick={() => renditionRef.current?.next()}>›</button>
      </div>
    </main>
  );
}
