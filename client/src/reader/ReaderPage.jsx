import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './reader.module.css';
import { api, bookFileUrl, getToken } from '../lib/api.js';
import { percent } from '../lib/format.js';
import { loadSettings, FONT_FAMILIES, resolveTheme } from '../lib/readerSettings.js';

// foliate-js is loaded as a static asset from /public; defining 'foliate-view'
// as a custom element. We dynamically import it once per session. The URL is
// built dynamically so Vite doesn't try to bundle it at build time.
let foliateLoaded = null;
function loadFoliate() {
  if (!foliateLoaded) {
    const url = new URL('/foliate-js/view.js', window.location.origin).href;
    foliateLoaded = import(/* @vite-ignore */ url);
  }
  return foliateLoaded;
}

export default function ReaderPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const lastSavedCfiRef = useRef(null);
  const [pct, setPct] = useState(0);
  const [page, setPage] = useState(null);
  const [pageCount, setPageCount] = useState(null);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let disposed = false;

    async function start() {
      try {
        await loadFoliate();
        if (disposed) return;

        const [progress, fileRes] = await Promise.all([
          api.getProgress(bookId),
          fetch(bookFileUrl(bookId), { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (!fileRes.ok) throw new Error('No se pudo cargar el libro');
        const buf = await fileRes.arrayBuffer();
        if (disposed) return;

        const file = new File([buf], 'book.epub', { type: 'application/epub+zip' });
        if (progress?.percentage != null) setPct(progress.percentage);
        if (progress?.cfi) lastSavedCfiRef.current = progress.cfi;

        const view = document.createElement('foliate-view');
        containerRef.current.appendChild(view);
        viewRef.current = view;

        await view.open(file);
        if (disposed) return;

        // Responsive column count: 1 on mobile/tablet, 2 on desktop, 3 on widescreen.
        const applyColumnCount = () => {
          const w = window.innerWidth;
          const cols = w >= 1700 ? 3 : w >= 1100 ? 2 : 1;
          try { view.renderer?.setAttribute('max-column-count', String(cols)); } catch {}
        };
        applyColumnCount();
        window.addEventListener('resize', applyColumnCount);

        // Apply reader settings as CSS injected into the rendition.
        const settings = loadSettings();
        const themeColors = resolveTheme(settings.theme);
        const fontFamily = FONT_FAMILIES[settings.fontFamily] || FONT_FAMILIES.system;
        const css = `
          @namespace epub "http://www.idpf.org/2007/ops";
          html, body { background: ${themeColors.background} !important; color: ${themeColors.color} !important; }
          body, p, div, span, li, h1, h2, h3, h4, h5, h6, a {
            font-family: ${fontFamily} !important;
            line-height: ${settings.lineHeight} !important;
            color: ${themeColors.color} !important;
          }
          html { font-size: ${settings.fontSize}% !important; }
          p { margin-top: ${(0.5 * settings.lineHeight).toFixed(2)}em !important; margin-bottom: 0 !important; }
        `;
        try { view.renderer.setStyles?.(css); } catch {}
        // Fixed: no vertical margin, half of the default horizontal gap (7% → 3.5%).
        try { view.renderer?.setAttribute('margin', '0'); } catch {}
        try { view.renderer?.setAttribute('gap', '3.5%'); } catch {}
        if (containerRef.current) {
          containerRef.current.style.background = themeColors.background;
        }

        if (view.book?.metadata?.title) setTitle(view.book.metadata.title);

        // Restore position. Prefer the saved cfi; fall back to the saved fraction.
        if (progress?.cfi) {
          try { await view.goTo(progress.cfi); }
          catch { if (progress.percentage) await view.goToFraction(progress.percentage); }
        } else if (progress?.percentage) {
          await view.goToFraction(progress.percentage);
        }

        setLoading(false);

        // Save only on user-initiated navigations.
        let savingEnabled = false;
        let pendingUserNavs = 0;
        const origNext = view.next.bind(view);
        const origPrev = view.prev.bind(view);
        view.next = () => { if (savingEnabled) pendingUserNavs++; return origNext(); };
        view.prev = () => { if (savingEnabled) pendingUserNavs++; return origPrev(); };
        setTimeout(() => { savingEnabled = true; }, 500);

        view.addEventListener('relocate', (e) => {
          const fraction = typeof e.detail?.fraction === 'number' ? e.detail.fraction : null;
          const cfi = e.detail?.cfi;
          const loc = e.detail?.location;

          // Always refresh the UI indicator — foliate-js gives accurate values
          // from the first relocate, no async generation needed.
          if (fraction !== null) setPct(fraction);
          if (loc && typeof loc.current === 'number' && typeof loc.total === 'number') {
            setPage(loc.current + 1);
            setPageCount(loc.total);
          }

          if (!savingEnabled) return;
          if (pendingUserNavs <= 0) return;
          pendingUserNavs--;

          if (cfi && cfi !== lastSavedCfiRef.current) {
            lastSavedCfiRef.current = cfi;
            api.putProgress(bookId, cfi, fraction).catch(() => {});
          }
        });

        // Keyboard navigation on the parent document.
        const onKey = (e) => {
          if (e.key === 'ArrowLeft') view.prev();
          else if (e.key === 'ArrowRight') view.next();
        };
        document.addEventListener('keydown', onKey);
        view.__cleanup = () => {
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('resize', applyColumnCount);
        };
      } catch (e) {
        console.error('[reader] error', e);
        setError(e.message);
        setLoading(false);
      }
    }

    start();
    return () => {
      disposed = true;
      const v = viewRef.current;
      if (v) {
        try { v.__cleanup?.(); } catch {}
        try { v.close?.(); } catch {}
        try { v.remove?.(); } catch {}
      }
      viewRef.current = null;
    };
  }, [bookId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')} aria-label="Volver">←</button>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.pct}>
          {pageCount && page ? `${page} / ${pageCount} (${percent(pct)})` : percent(pct)}
        </span>
      </header>
      <div className={styles.viewport} ref={containerRef}>
        {loading && <div className={styles.loading}>Cargando libro…</div>}
        {error && <div className={styles.loading} style={{ color: '#b00020' }}>{error}</div>}
        <button className={`${styles.navBtn} ${styles.navPrev}`} aria-label="Anterior"
          onClick={() => viewRef.current?.prev()}>‹</button>
        <button className={`${styles.navBtn} ${styles.navNext}`} aria-label="Siguiente"
          onClick={() => viewRef.current?.next()}>›</button>
      </div>
    </main>
  );
}
