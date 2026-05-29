import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './reader.module.css';
import { api, bookFileUrl, getToken } from '../lib/api.js';
import { percent } from '../lib/format.js';
import { loadSettings, FONT_FAMILIES, resolveTheme } from '../lib/readerSettings.js';
import { useFullscreen } from '../lib/useFullscreen.js';
import FullscreenButton from '../lib/FullscreenButton.jsx';

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
  const latestPosRef = useRef(null);
  const [pct, setPct] = useState(0);
  const [page, setPage] = useState(null);
  const [pageCount, setPageCount] = useState(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toc, setToc] = useState([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [chapter, setChapter] = useState('');
  const [isFullscreen, toggleFullscreen] = useFullscreen();
  const [handedness] = useState(() => loadSettings().handedness);
  const leftSideAdvances = handedness === 'left';
  const onLeftSide = () => leftSideAdvances ? viewRef.current?.next() : viewRef.current?.prev();
  const onRightSide = () => leftSideAdvances ? viewRef.current?.prev() : viewRef.current?.next();

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
        const hyphenCss = settings.hyphenation
          ? `body, p, li, blockquote, h1, h2, h3, h4, h5, h6 {
               hyphens: auto !important;
               -webkit-hyphens: auto !important;
               -ms-hyphens: auto !important;
               text-align: justify !important;
             }`
          : '';
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
          ${hyphenCss}
        `;
        try { view.renderer.setStyles?.(css); } catch {}
        // Fixed: no vertical margin, half of the default horizontal gap (7% → 3.5%).
        try { view.renderer?.setAttribute('margin', '0'); } catch {}
        try { view.renderer?.setAttribute('gap', '3.5%'); } catch {}
        if (containerRef.current) {
          containerRef.current.style.background = themeColors.background;
        }

        if (view.book?.metadata?.title) setTitle(view.book.metadata.title);
        const rawAuthor = view.book?.metadata?.author;
        if (rawAuthor) {
          const a = Array.isArray(rawAuthor) ? rawAuthor : [rawAuthor];
          const names = a.map(x => typeof x === 'string' ? x : (x?.name || '')).filter(Boolean);
          if (names.length) setAuthor(names.join(', '));
        }
        if (Array.isArray(view.book?.toc)) setToc(view.book.toc);

        // Restore position. Prefer fraction over cfi: foliate-js's relocate cfi
        // points at the first visible element, which may start on the previous
        // spread when a paragraph wraps across pages — landing us one page back.
        // Fraction lands on the spread that contains the saved position.
        if (progress?.percentage != null) {
          try { await view.goToFraction(progress.percentage); }
          catch { if (progress.cfi) await view.goTo(progress.cfi); }
        } else if (progress?.cfi) {
          await view.goTo(progress.cfi);
        }

        setLoading(false);

        // Save on any relocate after a short grace period (lets the initial
        // restore complete first). Covers side buttons, keyboard, swipe and
        // TOC jumps — all of them go through the relocate event.
        let savingEnabled = false;
        setTimeout(() => { savingEnabled = true; }, 500);

        // Fallback lang on each section's document so hyphens: auto can work
        // even when the book itself doesn't declare a language.
        view.addEventListener('load', (e) => {
          const doc = e.detail?.doc;
          if (!doc?.documentElement) return;
          if (!doc.documentElement.getAttribute('lang')) {
            const raw = view.book?.metadata?.language;
            const lang = (Array.isArray(raw) ? raw[0] : raw) || 'es';
            doc.documentElement.setAttribute('lang', String(lang).split(/[-_]/)[0]);
          }
        });

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
          const label = e.detail?.tocItem?.label;
          if (typeof label === 'string') setChapter(label.trim());

          if (!savingEnabled) return;
          // Ignore non-positional relocates (text selection bookkeeping).
          if (e.detail?.reason === 'selection') return;

          // Save a "mid-page" fraction so restoring via goToFraction lands
          // squarely on the page the user was viewing. foliate's raw fraction
          // sits at the page boundary and goToFraction can round to the next.
          const saveFraction = (loc && typeof loc.current === 'number' && loc.total)
            ? (loc.current + 0.5) / loc.total
            : fraction;

          if (cfi) {
            latestPosRef.current = { cfi, fraction: saveFraction };
            if (cfi !== lastSavedCfiRef.current) {
              lastSavedCfiRef.current = cfi;
              api.putProgress(bookId, cfi, saveFraction).catch(() => {});
            }
          }
        });

        // Flush the latest position on tab hide / page unload so navigating
        // back to the library — or closing the tab — never loses progress.
        const flush = () => {
          const pos = latestPosRef.current;
          if (!pos) return;
          api.putProgressKeepalive(bookId, pos.cfi, pos.fraction);
        };
        const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', flush);
        view.__flush = flush;
        view.__detachFlush = () => {
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('pagehide', flush);
        };

        // Keyboard navigation on the parent document.
        const onKey = (e) => {
          if (e.key === 'ArrowLeft') view.prev();
          else if (e.key === 'ArrowRight') view.next();
          else if (e.key === 'f' || e.key === 'F') {
            if (document.fullscreenElement) document.exitFullscreen?.();
            else document.documentElement.requestFullscreen?.().catch(() => {});
          }
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
        try { v.__flush?.(); } catch {}
        try { v.__detachFlush?.(); } catch {}
        try { v.__cleanup?.(); } catch {}
        try { v.close?.(); } catch {}
        try { v.remove?.(); } catch {}
      }
      viewRef.current = null;
    };
  }, [bookId]);

  const [selectionMode, setSelectionMode] = useState(false);

  const goToChapter = (href) => {
    if (!href) return;
    try { viewRef.current?.goTo(href); } catch {}
    setTocOpen(false);
  };

  const goBack = async () => {
    const pos = latestPosRef.current;
    if (pos) {
      try { await api.putProgress(bookId, pos.cfi, pos.fraction); } catch {}
    }
    navigate('/');
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={goBack} aria-label="Volver">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div className={styles.titleBox}>
          <h1 className={styles.title}>{title}</h1>
          {author && <p className={styles.author}>{author}</p>}
        </div>
        {toc.length > 0 && (
          <button className={styles.back} onClick={() => setTocOpen(true)}
            aria-label="Índice de capítulos" title="Índice de capítulos">☰</button>
        )}
        <button className={`${styles.back} ${selectionMode ? styles.backActive : ''}`}
          onClick={() => setSelectionMode((v) => !v)}
          aria-label={selectionMode ? 'Salir del modo selección' : 'Modo selección de texto'}
          title={selectionMode ? 'Salir del modo selección' : 'Seleccionar texto'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4h3M15 4h3M4 6V4h2M18 4h2v2M4 18v2h2M18 20h2v-2M9 20H6M6 9V6M18 9V6M14 11v8M11 11h6"/>
          </svg>
        </button>
        <FullscreenButton className={styles.back} isFullscreen={isFullscreen} onToggle={toggleFullscreen} hint="F" />
      </header>
      <div className={styles.viewport} ref={containerRef}>
        {loading && <div className={styles.loading}>Cargando libro…</div>}
        {error && <div className={styles.loading} style={{ color: '#b00020' }}>{error}</div>}
        <button className={`${styles.navBtn} ${styles.navPrev} ${selectionMode ? styles.navPassthrough : ''}`}
          aria-label={leftSideAdvances ? 'Siguiente' : 'Anterior'}
          onClick={onLeftSide}>‹</button>
        <button className={`${styles.navBtn} ${styles.navNext} ${selectionMode ? styles.navPassthrough : ''}`}
          aria-label={leftSideAdvances ? 'Anterior' : 'Siguiente'}
          onClick={onRightSide}>›</button>
        {selectionMode && (
          <div className={styles.selectionHint} aria-hidden>
            Mantén presionado para seleccionar texto. Toca el ícono para salir.
          </div>
        )}
      </div>
      <footer className={styles.footer}>
        <span className={styles.footerPages}>
          {pageCount && page ? `${page} / ${pageCount}` : '—'}
        </span>
        <span className={styles.footerChapter}>{chapter}</span>
        <span className={styles.footerPct}>{percent(pct)}</span>
      </footer>
      {tocOpen && (
        <>
          <div className={styles.tocBackdrop} onClick={() => setTocOpen(false)} />
          <aside className={styles.tocPanel} aria-label="Índice">
            <div className={styles.tocHeader}>
              <h2 className={styles.tocTitle}>Capítulos</h2>
              <button className={styles.back} onClick={() => setTocOpen(false)} aria-label="Cerrar">✕</button>
            </div>
            <nav className={styles.tocList}>
              <TocList items={toc} onPick={goToChapter} />
            </nav>
          </aside>
        </>
      )}
    </main>
  );
}

function TocList({ items, onPick, depth = 0 }) {
  return (
    <ul className={styles.tocUl} style={{ paddingInlineStart: depth === 0 ? 0 : 14 }}>
      {items.map((it, i) => (
        <li key={i}>
          <button className={styles.tocItem} onClick={() => onPick(it.href)} disabled={!it.href}>
            {it.label?.trim() || 'Sin título'}
          </button>
          {Array.isArray(it.subitems) && it.subitems.length > 0 && (
            <TocList items={it.subitems} onPick={onPick} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}
