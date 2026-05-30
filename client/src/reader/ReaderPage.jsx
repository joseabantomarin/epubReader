import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import styles from './reader.module.css';
import { api, bookFileUrl, sharedFileUrl, getToken } from '../lib/api.js';
import { getBookFile, putBookFile } from '../lib/offlineCache.js';
import { getProgressLocal, saveProgressLocal, markSynced } from '../lib/offlineProgress.js';
import { percent } from '../lib/format.js';
import { loadSettings, FONT_FAMILIES, resolveTheme } from '../lib/readerSettings.js';
import { useFullscreen } from '../lib/useFullscreen.js';
import FullscreenButton from '../lib/FullscreenButton.jsx';
import SelectionMenu from './SelectionMenu.jsx';
import WiktionaryModal from './WiktionaryModal.jsx';
import AIExplainModal from './AIExplainModal.jsx';
import NoteModal from './NoteModal.jsx';
import AnnotationsDrawer from './AnnotationsDrawer.jsx';
import { useReadAloud } from './useReadAloud.js';
import ReadAloudDialog from './ReadAloudDialog.jsx';

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

const COLOR_HIGHLIGHT = '#ffd400';   // plain highlight (no note)
const COLOR_NOTE      = '#a0e8a0';   // highlight that has a note attached
const LAST_ACTION_KEY = 'epubreader.lastHeaderAction';  // remembers the collapsed icon

function colorFor(note) {
  return (note && note.trim()) ? COLOR_NOTE : COLOR_HIGHLIGHT;
}

// Convert a DOM Range inside a chapter iframe to viewport coordinates.
// The Range's getBoundingClientRect is iframe-relative — add the iframe's
// own offset to get fixed-position coords for menu placement.
function rangeToViewportRect(range) {
  if (!range) return null;
  const doc = range.startContainer?.ownerDocument;
  const iframe = doc?.defaultView?.frameElement;
  const r = range.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  const offX = iframe ? iframe.getBoundingClientRect().x : 0;
  const offY = iframe ? iframe.getBoundingClientRect().y : 0;
  return { x: r.x + offX, y: r.y + offY, w: r.width, h: r.height };
}

export default function ReaderPage() {
  const { bookId } = useParams();
  const [searchParams] = useSearchParams();
  const isShared = searchParams.get('shared') === '1' || !getToken();
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
  // Mobile: the header actions (except read-aloud) collapse behind a toggle.
  const [actionsOpen, setActionsOpen] = useState(false);
  const [lastAction, setLastAction] = useState(() => {
    try { return localStorage.getItem(LAST_ACTION_KEY); } catch { return null; }
  });
  const [chapter, setChapter] = useState('');
  const [isFullscreen, toggleFullscreen] = useFullscreen();
  const [handedness] = useState(() => loadSettings().handedness);
  const leftSideAdvances = handedness === 'left';
  // On Android (Capacitor) we rely on swipe + volume keys, no tap zones and
  // no selection-mode toggle — the system long-press already selects text.
  const isNative = Capacitor.isNativePlatform();
  const onLeftSide = () => leftSideAdvances ? viewRef.current?.next() : viewRef.current?.prev();
  const onRightSide = () => leftSideAdvances ? viewRef.current?.prev() : viewRef.current?.next();

  const [annotations, setAnnotations] = useState([]);
  const annotationsRef = useRef([]);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  // Active selection: { text, cfi, rect:{x,y,w,h}, existingId? }. rect is in viewport coords.
  const [selection, setSelection] = useState(null);
  const [dictTerm, setDictTerm] = useState(null);
  const [aiText, setAiText] = useState(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [noteFor, setNoteFor] = useState(null);   // { id?, text, cfi, note }
  const [bookLang, setBookLang] = useState('es');
  const docsRef = useRef(new Map());                // index → { doc, iframe }

  useEffect(() => {
    let disposed = false;

    async function start() {
      try {
        await loadFoliate();
        if (disposed) return;

        // Try the local copy first (works offline, instant). If absent, fetch
        // from the server and store the buffer for next time.
        let buf = await getBookFile(bookId);
        const serverProgress = isShared ? null : await api.getProgress(bookId).catch(() => null);
        const progress = serverProgress || getProgressLocal(bookId);
        if (!buf) {
          const fileRes = await fetch(
            isShared ? sharedFileUrl(bookId) : bookFileUrl(bookId),
            isShared ? {} : { headers: { Authorization: `Bearer ${getToken()}` } },
          );
          if (!fileRes.ok) throw new Error('No se pudo cargar el libro');
          buf = await fileRes.arrayBuffer();
          putBookFile(bookId, buf).catch(() => {});
        }
        if (disposed) return;

        // PDFs are rendered by foliate's fixed-layout view, which (unlike the
        // reflowable EPUB renderer) has no built-in swipe gesture — we add one
        // below. Detect by the "%PDF-" magic since the File is always named .epub.
        const head = new Uint8Array(buf.slice(0, 5));
        const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44
          && head[3] === 0x46 && head[4] === 0x2d;

        const file = new File([buf], 'book.epub', { type: 'application/epub+zip' });
        if (progress?.percentage != null) setPct(progress.percentage);
        if (progress?.cfi) lastSavedCfiRef.current = progress.cfi;

        const view = document.createElement('foliate-view');
        containerRef.current.appendChild(view);
        viewRef.current = view;

        // Attach annotation / selection listeners BEFORE view.open(file) so the
        // first chapter's `load` event (fired during open) isn't missed —
        // otherwise selectionchange listeners never get attached to that doc.
        const { Overlayer } = await import(/* @vite-ignore */
          new URL('/foliate-js/overlayer.js', window.location.origin).href);
        view.addEventListener('draw-annotation', (ev) => {
          const { draw, annotation } = ev.detail;
          draw(Overlayer.highlight, { color: annotation?.color || '#ffd400' });
        });
        view.addEventListener('show-annotation', (ev) => {
          const { value, range } = ev.detail;
          const ann = annotationsRef.current.find(a => a.cfi === value);
          if (!ann) return;
          const rect = rangeToViewportRect(range);
          if (!rect) return;
          setSelection({ text: ann.text, cfi: ann.cfi, rect, existingId: ann.id, note: ann.note });
        });
        view.addEventListener('load', (e) => {
          const doc = e.detail?.doc;
          const index = e.detail?.index;
          if (!doc?.documentElement) return;
          if (!doc.documentElement.getAttribute('lang')) {
            const raw = view.book?.metadata?.language;
            const lang = (Array.isArray(raw) ? raw[0] : raw) || 'es';
            doc.documentElement.setAttribute('lang', String(lang).split(/[-_]/)[0]);
          }
          docsRef.current.set(index, { doc, iframe: doc.defaultView?.frameElement || null });

          const onSelectionChange = () => {
            // While reading aloud, foliate highlights (selects) each spoken
            // block — don't pop the selection menu for that.
            if (readingRef.current) return;
            const sel = doc.getSelection();
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
              setSelection((prev) => (prev?.existingId ? prev : null));
              return;
            }
            const range = sel.getRangeAt(0);
            const text = sel.toString().trim();
            if (!text) { setSelection(null); return; }
            const rect = rangeToViewportRect(range);
            if (!rect) return;
            let cfi = null;
            try { cfi = view.getCFI(index, range); } catch {}
            setSelection({ text, cfi, rect, existingId: null });
          };
          let pending = null;
          const debouncedSelChange = () => {
            if (pending) clearTimeout(pending);
            pending = setTimeout(onSelectionChange, 150);
          };
          doc.addEventListener('selectionchange', debouncedSelChange);
          doc.addEventListener('touchend', onSelectionChange);
          doc.addEventListener('mouseup', onSelectionChange);

          // PDF page-turn by drag: foliate's fixed-layout renderer doesn't do
          // this itself, so we detect a quick horizontal swipe on the page doc.
          if (isPdf) {
            let sx = 0, sy = 0, st = 0;
            const onTouchStart = (ev) => {
              const t = ev.changedTouches?.[0];
              if (!t) return;
              sx = t.clientX; sy = t.clientY; st = ev.timeStamp;
            };
            const onTouchEnd = (ev) => {
              const t = ev.changedTouches?.[0];
              if (!t) return;
              // Ignore if the user was selecting text rather than swiping.
              const sel = doc.getSelection();
              if (sel && !sel.isCollapsed) return;
              const dx = t.clientX - sx, dy = t.clientY - sy;
              if (ev.timeStamp - st > 800) return;
              if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
              if (dx < 0) view.next(); else view.prev();
            };
            doc.addEventListener('touchstart', onTouchStart, { passive: true });
            doc.addEventListener('touchend', onTouchEnd, { passive: true });
          }
        });

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

        // Fetch annotations from the server and paint them. Draw / show
        // listeners were attached before view.open.
        const rawLang = view.book?.metadata?.language;
        const detectedLang = String((Array.isArray(rawLang) ? rawLang[0] : rawLang) || 'es').split(/[-_]/)[0];
        setBookLang(detectedLang);
        if (!isShared) {
          try {
            const list = await api.listAnnotations(bookId);
            if (!disposed && Array.isArray(list)) {
              setAnnotations(list);
              for (const a of list) {
                try { await view.addAnnotation({ value: a.cfi, color: a.color }); } catch {}
              }
            }
          } catch { /* offline or not yet — silent */ }
        }

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
            saveProgressLocal(bookId, cfi, saveFraction);
            if (!isShared && cfi !== lastSavedCfiRef.current) {
              lastSavedCfiRef.current = cfi;
              api.putProgress(bookId, cfi, saveFraction)
                .then(() => markSynced(bookId))
                .catch(() => { /* stays unsynced; flushed by useSyncQueue */ });
            }
          }
        });

        // Flush the latest position on tab hide / page unload so navigating
        // back to the library — or closing the tab — never loses progress.
        const flush = () => {
          const pos = latestPosRef.current;
          if (!pos || isShared) return;
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

        // Hardware volume buttons on Android (Capacitor): MainActivity hijacks
        // KEYCODE_VOLUME_UP/DOWN and dispatches a 'hardwareVolume' CustomEvent.
        const onVolume = (e) => {
          if (readingRef.current) return; // reading aloud: leave volume to the OS
          const which = e.detail;
          if (which === 'volumeUp') leftSideAdvances ? view.next() : view.prev();
          else if (which === 'volumeDown') leftSideAdvances ? view.prev() : view.next();
        };
        window.addEventListener('hardwareVolume', onVolume);

        view.__cleanup = () => {
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('hardwareVolume', onVolume);
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
  }, [bookId, isShared]);

  const [selectionMode, setSelectionMode] = useState(false);

  // Web only: intercept the browser back button while selection mode is on.
  // Push a fake history entry on activate; popstate (back press) deactivates
  // instead of navigating away. Manual toggle-off pops our entry to keep the
  // back stack clean.
  useEffect(() => {
    if (isNative || !selectionMode) return;
    window.history.pushState({ selMode: true }, '');
    let poppedByUser = false;
    const onPop = () => { poppedByUser = true; setSelectionMode(false); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!poppedByUser) window.history.back();
    };
  }, [selectionMode, isNative]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Always anchor the menu below the selection. On mobile web the browser's
  // own selection toolbar lives above the text, so putting ours above too
  // would collide — keeping ours below avoids the overlap.
  const menuPos = (() => {
    if (!selection?.rect) return null;
    const { x, y, w, h } = selection.rect;
    return { x: x + w / 2, y: y + h + 12 };
  })();

  const refreshAnnotations = async () => {
    try {
      const list = await api.listAnnotations(bookId);
      if (Array.isArray(list)) setAnnotations(list);
    } catch {}
  };

  const onHighlight = async () => {
    if (!selection?.cfi) { setSelection(null); return; }
    try {
      const ann = await api.createAnnotation(bookId, {
        cfi: selection.cfi, text: selection.text, note: '', color: COLOR_HIGHLIGHT,
        chapter: chapter || null, page: page ?? null,
      });
      setAnnotations((prev) => [...prev, ann]);
      try { await viewRef.current?.addAnnotation({ value: ann.cfi, color: ann.color }); } catch {}
    } catch (e) { console.error('[highlight]', e); }
    clearSelection();
  };

  const onNote = async () => {
    if (selection?.existingId) {
      setNoteFor({ id: selection.existingId, text: selection.text, cfi: selection.cfi, note: selection.note || '' });
    } else if (selection?.cfi) {
      setNoteFor({ text: selection.text, cfi: selection.cfi, note: '' });
    }
  };

  const saveNote = async (note) => {
    if (!noteFor) return;
    const color = colorFor(note);
    try {
      if (noteFor.id) {
        await api.updateAnnotation(bookId, noteFor.id, { note, color });
        setAnnotations((prev) => prev.map(a => a.id === noteFor.id ? { ...a, note, color } : a));
        // Repaint the highlight with the new color (foliate doesn't update in place).
        try {
          await viewRef.current?.deleteAnnotation({ value: noteFor.cfi });
          await viewRef.current?.addAnnotation({ value: noteFor.cfi, color });
        } catch {}
      } else {
        const ann = await api.createAnnotation(bookId, {
          cfi: noteFor.cfi, text: noteFor.text, note, color,
          chapter: chapter || null, page: page ?? null,
        });
        setAnnotations((prev) => [...prev, ann]);
        try { await viewRef.current?.addAnnotation({ value: ann.cfi, color: ann.color }); } catch {}
      }
    } catch (e) { console.error('[note save]', e); }
    setNoteFor(null);
    clearSelection();
  };

  const deleteAnnotationById = async (id, cfi) => {
    if (!id) return;
    try {
      await api.deleteAnnotation(bookId, id);
      try { await viewRef.current?.deleteAnnotation({ value: cfi }); } catch {}
      setAnnotations((prev) => prev.filter(a => a.id !== id));
    } catch (e) { console.error('[delete]', e); }
  };
  const onDelete = async () => {
    if (!selection?.existingId) return;
    await deleteAnnotationById(selection.existingId, selection.cfi);
    setNoteFor(null);
    clearSelection();
  };
  const deleteCurrentNote = async () => {
    if (!noteFor?.id) return;
    await deleteAnnotationById(noteFor.id, noteFor.cfi);
    setNoteFor(null);
    clearSelection();
  };

  const onCopy = async () => {
    if (!selection?.text) return;
    try { await navigator.clipboard?.writeText(selection.text); } catch {}
    clearSelection();
  };

  const onShare = async () => {
    if (!selection?.text) return;
    try {
      if (navigator.share) await navigator.share({ text: selection.text, title });
      else await navigator.clipboard?.writeText(selection.text);
    } catch {}
    clearSelection();
  };

  const onDictionary = () => {
    if (!selection?.text) return;
    const first = selection.text.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'-]/gu, '');
    if (first) setDictTerm(first);
  };

  const clearSelection = () => {
    // Drop the React state AND clear the iframe selection so a stray touch
    // doesn't reopen the menu.
    setSelection(null);
    for (const { doc } of docsRef.current.values()) {
      try { doc.getSelection()?.removeAllRanges(); } catch {}
    }
  };

  // From the drawer: open the note modal for this annotation. The modal has
  // its own "Ir al pasaje" button if the user actually wants to jump there.
  const pickAnnotation = (a) => {
    setAnnotationsOpen(false);
    setNoteFor({ id: a.id, text: a.text, cfi: a.cfi, note: a.note || '' });
  };
  const jumpToCurrentNote = async () => {
    if (!noteFor?.cfi) return;
    setNoteFor(null);
    try { await viewRef.current?.goTo(noteFor.cfi); } catch {}
  };

  const goToChapter = (href) => {
    if (!href) return;
    try { viewRef.current?.goTo(href); } catch {}
    setTocOpen(false);
  };

  const goBack = async () => {
    const pos = latestPosRef.current;
    if (pos && !isShared) {
      try { await api.putProgress(bookId, pos.cfi, pos.fraction); } catch {}
    }
    navigate('/');
  };

  const getView = useCallback(() => viewRef.current, []);

  const { reading, start: startReadAloud, stop: stopReadAloud } =
    useReadAloud({ getView, lang: bookLang });

  // While reading aloud on Android, stop hijacking the volume keys for page
  // turns so they control the audio volume instead. `readingRef` lets the
  // (closure-captured) volume handler see the current state.
  const readingRef = useRef(false);
  useEffect(() => {
    readingRef.current = reading;
    if (isNative) { try { window.AndroidVolume?.setHijack?.(!reading); } catch {} }
  }, [reading]);

  const [readDialogOpen, setReadDialogOpen] = useState(false);
  const onSpeakerClick = useCallback(() => {
    if (reading) { stopReadAloud(); return; }
    setReadDialogOpen(true);
  }, [reading, stopReadAloud]);

  // Remember the last collapsible action used (drives the collapsed icon) and
  // close the expanded cluster so the title regains its space.
  const recordAction = useCallback((id) => {
    setLastAction(id);
    try { localStorage.setItem(LAST_ACTION_KEY, id); } catch {}
    setActionsOpen(false);
  }, []);

  // Collapsible actions present for this session, in display order.
  const availableActions = [
    toc.length > 0 && 'toc',
    !isShared && 'annotations',
    !isNative && !isShared && 'selection',
    !isNative && 'fullscreen',
  ].filter(Boolean);
  const indicatorAction = availableActions.includes(lastAction)
    ? lastAction
    : availableActions[0];

  // Web only: turning the screen off (or backgrounding the tab) suspends the
  // Web Speech API. Stop reading and, on return, hint that the app keeps
  // playing with the screen off. (Native TTS keeps going, so this is skipped.)
  const [showOffHint, setShowOffHint] = useState(false);
  useEffect(() => {
    if (isNative || !reading) return;
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        stopReadAloud();
        setShowOffHint(true);
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [isNative, reading, stopReadAloud]);

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
        {/* Read-aloud stays visible at all sizes */}
        <button className={`${styles.back} ${reading ? styles.backActive : ''}`}
          onClick={onSpeakerClick}
          aria-label={reading ? 'Detener lectura' : 'Leer en voz alta'}
          title={reading ? 'Detener lectura' : 'Leer en voz alta'}>
          {reading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>
            </svg>
          )}
        </button>
        {/* On small web screens these collapse behind the toggle; desktop and
            Android (native) always show them inline. */}
        <div className={styles.collapsible}
          data-open={actionsOpen ? 'true' : 'false'}
          data-native={isNative ? 'true' : 'false'}>
          {toc.length > 0 && (
            <button className={styles.back} onClick={() => { setTocOpen(true); recordAction('toc'); }}
              aria-label="Índice de capítulos" title="Índice de capítulos">☰</button>
          )}
          {!isShared && (
            <button className={styles.back} onClick={() => { setAnnotationsOpen(true); recordAction('annotations'); }}
              aria-label="Subrayados" title="Subrayados">★</button>
          )}
          {!isNative && !isShared && (
            <button className={`${styles.back} ${selectionMode ? styles.backActive : ''}`}
              onClick={() => { setSelectionMode((v) => !v); recordAction('selection'); }}
              aria-label={selectionMode ? 'Salir del modo selección' : 'Modo selección de texto'}
              title={selectionMode ? 'Salir del modo selección' : 'Seleccionar texto'}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 4h3M15 4h3M4 6V4h2M18 4h2v2M4 18v2h2M18 20h2v-2M9 20H6M6 9V6M18 9V6M14 11v8M11 11h6"/>
              </svg>
            </button>
          )}
          {!isNative && (
            <FullscreenButton className={styles.back} isFullscreen={isFullscreen}
              onToggle={() => { toggleFullscreen(); recordAction('fullscreen'); }} hint="F" />
          )}
        </div>
        {!isNative && availableActions.length > 0 && (
          <button className={styles.actionsToggle} data-open={actionsOpen ? 'true' : 'false'}
            onClick={() => setActionsOpen((v) => !v)}
            aria-expanded={actionsOpen}
            aria-label={actionsOpen ? 'Ocultar acciones' : 'Mostrar acciones'}
            title={actionsOpen ? 'Ocultar acciones' : 'Mostrar acciones'}>
            <ChevronIcon className={styles.chevron} />
            {!actionsOpen && (
              <span className={styles.lastIcon}><ActionIcon action={indicatorAction} /></span>
            )}
          </button>
        )}
      </header>
      <div className={styles.viewport} ref={containerRef}>
        {loading && <div className={styles.loading}>Cargando libro…</div>}
        {error && <div className={styles.loading} style={{ color: '#b00020' }}>{error}</div>}
        {!isNative && (
          <>
            <button className={`${styles.navBtn} ${styles.navPrev} ${selectionMode ? styles.navPassthrough : ''}`}
              aria-label={leftSideAdvances ? 'Siguiente' : 'Anterior'}
              onClick={onLeftSide}>‹</button>
            <button className={`${styles.navBtn} ${styles.navCenter} ${selectionMode ? styles.navPassthrough : ''}`}
              aria-label={selectionMode ? 'Salir del modo selección' : 'Activar selección de texto'}
              onClick={() => { if (!isShared) setSelectionMode((v) => !v); }} />
            <button className={`${styles.navBtn} ${styles.navNext} ${selectionMode ? styles.navPassthrough : ''}`}
              aria-label={leftSideAdvances ? 'Anterior' : 'Siguiente'}
              onClick={onRightSide}>›</button>
          </>
        )}
      </div>
      {selectionMode && (
        <div className={styles.selectionBanner} role="status">
          Mantén presionado para seleccionar texto. Toca el ícono para salir.
        </div>
      )}
      {showOffHint && (
        <div className={styles.offHint} role="status">
          <span>Lectura detenida. Si desea escuchar con el dispositivo Android apagado, descargue la aplicación.</span>
          <button className={styles.offHintClose} onClick={() => setShowOffHint(false)} aria-label="Cerrar">×</button>
        </div>
      )}
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

      {!isShared && (
        <SelectionMenu
          pos={reading ? null : menuPos}
          existingId={selection?.existingId}
          onDictionary={onDictionary}
          onHighlight={onHighlight}
          onNote={onNote}
          onCopy={onCopy}
          onShare={onShare}
          onDelete={onDelete}
          showAI={online}
          onExplainAI={() => { if (selection?.text) setAiText(selection.text); }}
        />
      )}
      <WiktionaryModal
        open={!!dictTerm}
        term={dictTerm || ''}
        lang={bookLang}
        onClose={() => { setDictTerm(null); clearSelection(); }}
      />
      <AIExplainModal text={aiText} onClose={() => { setAiText(null); clearSelection(); }} />
      <ReadAloudDialog
        open={readDialogOpen}
        onClose={() => setReadDialogOpen(false)}
        onStart={(minutes) => { setReadDialogOpen(false); startReadAloud(minutes); }}
      />
      <NoteModal
        open={!!noteFor}
        snippet={noteFor?.text}
        initialNote={noteFor?.note || ''}
        onSave={saveNote}
        onClose={() => { setNoteFor(null); clearSelection(); }}
        onDelete={noteFor?.id ? deleteCurrentNote : null}
        onJump={noteFor?.id ? jumpToCurrentNote : null}
      />
      <AnnotationsDrawer
        open={annotationsOpen}
        annotations={annotations}
        onJump={pickAnnotation}
        onClose={() => setAnnotationsOpen(false)}
      />
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

// Chevron for the collapsed actions toggle (points left when closed).
function ChevronIcon({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6"/>
    </svg>
  );
}

// Icon shown next to the chevron when collapsed — mirrors the last action used.
function ActionIcon({ action }) {
  switch (action) {
    case 'toc':
      return <span aria-hidden="true">☰</span>;
    case 'annotations':
      return <span aria-hidden="true">★</span>;
    case 'selection':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4h3M15 4h3M4 6V4h2M18 4h2v2M4 18v2h2M18 20h2v-2M9 20H6M6 9V6M18 9V6M14 11v8M11 11h6"/>
        </svg>
      );
    case 'fullscreen':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>
        </svg>
      );
    default:
      return null;
  }
}
