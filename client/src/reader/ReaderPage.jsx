import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { ArrowLeft, Volume2, Square, Menu, Star, Settings, ChevronLeft, Maximize2, X } from 'lucide-react';
import styles from './reader.module.css';
import { api, bookFileUrl, sharedFileUrl, getToken } from '../lib/api.js';
import { getBookFile, putBookFile } from '../lib/offlineCache.js';
import { getProgressLocal, saveProgressLocal, markSynced } from '../lib/offlineProgress.js';
import { percent } from '../lib/format.js';
import { loadSettings, FONT_FAMILIES, resolveTheme } from '../lib/readerSettings.js';
import { useFullscreen } from '../lib/useFullscreen.js';
import { registerBackHandler } from '../lib/backActions.js';
import FullscreenButton from '../lib/FullscreenButton.jsx';
import SelectionMenu from './SelectionMenu.jsx';
import WiktionaryModal from './WiktionaryModal.jsx';
import AIExplainModal from './AIExplainModal.jsx';
import NoteModal from './NoteModal.jsx';
import AnnotationsDrawer from './AnnotationsDrawer.jsx';
import { useReadAloud } from './useReadAloud.js';
import ReadAloudDialog from './ReadAloudDialog.jsx';
import SettingsModal from '../library/SettingsModal.jsx';

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

// Diagnóstico de selección (SEL-DBG): panel superpuesto que registra en el
// propio dispositivo los eventos de selección y sus estados. Se activa
// visitando la app con ?seldbg=1 (persiste en localStorage; ?seldbg=0 lo
// apaga) — invisible para cualquier otro usuario.
function seldbgOn() {
  try { return localStorage.getItem('epubreader.seldbg') === '1'; } catch { return false; }
}
function selDbg(msg) {
  if (!seldbgOn()) return;
  try {
    let el = document.getElementById('__seldbg');
    if (!el) {
      el = document.createElement('div');
      el.id = '__seldbg';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;'
        + 'background:rgba(0,0,0,.82);color:#3f6;font:11px/1.35 monospace;'
        + 'padding:6px 8px;max-height:45%;overflow:auto;white-space:pre-wrap;pointer-events:none;';
      document.body.appendChild(el);
    }
    const line = Math.round(performance.now()) + ' ' + msg;
    const prev = el.textContent.split('\n').slice(1, 22).join('\n');
    el.textContent = 'SEL-DBG build 4 (web) — mantén presionado y selecciona\n' + line + '\n' + prev;
  } catch { /* ignore */ }
}

export default function ReaderPage() {
  const { bookId } = useParams();
  const [searchParams] = useSearchParams();
  const isShared = searchParams.get('shared') === '1' || !getToken();
  const navigate = useNavigate();
  const location = useLocation();
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const lastSavedCfiRef = useRef(null);
  const latestPosRef = useRef(null);
  // Saltos de posición pendientes (enlace / índice / anotación). La profundidad
  // vive en el state del router; estas refs la espejan para los listeners.
  const jumpDepthRef = useRef(0);
  const historyNavRef = useRef(false); // true mientras nosotros llamamos back()/forward()
  const [jumpDepth, setJumpDepth] = useState(0);
  const [chipDismissed, setChipDismissed] = useState(false);
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
    // The foliate-view created by THIS effect invocation. Tracked locally (not
    // just via viewRef) so cleanup tears down exactly the view this run made.
    // Under React.StrictMode the effect mounts -> cleanup -> mounts again; the
    // first run is async, so its cleanup can fire before viewRef is even set.
    // Keying teardown off this local var (plus the disposed check after append)
    // guarantees the first run's view is removed and the document isn't opened
    // twice, so it never visibly reloads in dev.
    let ownView = null;
    // Teardown callbacks collected as each listener is registered. Run directly
    // from the effect cleanup so removal never depends on how far `start()` got:
    // unmounting mid-open (e.g. while goToFraction / annotation fetch is still
    // awaiting) would otherwise leak the window/document listeners, since a
    // single end-of-start cleanup handle wouldn't be assigned yet.
    const cleanups = [];

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
          // Send the token whenever we have one — public books open without it,
          // but group/individual shares require it (access is checked server-side).
          const authToken = getToken();
          const fileRes = await fetch(
            isShared ? sharedFileUrl(bookId) : bookFileUrl(bookId),
            authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {},
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
        // If this run was already disposed (StrictMode's first mount) bail before
        // touching the DOM so we don't append a stray, never-cleaned-up view.
        if (disposed) return;
        containerRef.current.appendChild(view);
        viewRef.current = view;
        ownView = view;

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
          selDbg('load idx=' + index);

          // Read the current selection and, if it's real, show the menu.
          // Returns true when a menu was shown, false when the selection is
          // empty/collapsed. It never clears on its own — dismissal is the
          // callers' job (see onPointerUp).
          const showSelectionIfAny = () => {
            // While reading aloud, foliate highlights (selects) each spoken
            // block — don't pop the selection menu for that.
            if (readingRef.current) { selDbg('show: reading, skip'); return false; }
            const sel = doc.getSelection();
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) { selDbg('show: no/collapsed sel'); return false; }
            const range = sel.getRangeAt(0);
            const text = sel.toString().trim();
            if (!text) { selDbg('show: empty text'); return false; }
            const rect = rangeToViewportRect(range);
            if (!rect) { selDbg('show: NULL rect (0x0)'); return false; }
            let cfi = null;
            try { cfi = view.getCFI(index, range); } catch {}
            setSelection({ text, cfi, rect, existingId: null });
            selDbg('show: MENU len=' + text.length);
            return true;
          };
          // Instantánea del estado de getSelection() en cada evento (SEL-DBG).
          const snap = (ev) => {
            if (!seldbgOn()) return;
            const sel = doc.getSelection();
            const text = sel ? sel.toString().trim() : '';
            let rect = null;
            try { if (sel && sel.rangeCount) rect = rangeToViewportRect(sel.getRangeAt(0)); } catch { /* ignore */ }
            selDbg(`${ev} rc=${sel ? sel.rangeCount : '-'} col=${sel ? sel.isCollapsed : '-'} len=${text.length} rect=${rect ? Math.round(rect.w) + 'x' + Math.round(rect.h) : 'null'}`);
          };
          // Pointer release (tap or end of a long-press selection). This is the
          // ONLY path allowed to dismiss the menu: a tap on empty space
          // collapses the selection, so we close the menu.
          const onPointerUp = () => {
            snap('up');
            if (readingRef.current) return;
            if (!showSelectionIfAny()) setSelection((prev) => (prev?.existingId ? prev : null));
          };
          // selectionchange only PROMOTES a fresh selection into the menu; it
          // never dismisses. Some WebViews (seen on an Android 14/15 Motorola)
          // fire a spurious "collapsed" selectionchange right after the
          // selection is made; if that were allowed to clear the state, the
          // menu would appear and vanish instantly. Dismissal is left to
          // onPointerUp (a real tap).
          let pending = null;
          const debouncedSelChange = () => {
            snap('selchange');
            if (pending) clearTimeout(pending);
            pending = setTimeout(showSelectionIfAny, 150);
          };
          doc.addEventListener('selectionchange', debouncedSelChange);
          doc.addEventListener('touchstart', () => snap('touchstart'), { passive: true });
          doc.addEventListener('pointerup', () => snap('pointerup'), { passive: true });
          doc.addEventListener('touchend', onPointerUp);
          doc.addEventListener('mouseup', onPointerUp);
          if (seldbgOn()) {
            doc.addEventListener('pointerdown', () => snap('pointerdown'), { passive: true });
            doc.addEventListener('pointercancel', () => snap('pointercancel'), { passive: true });
            doc.addEventListener('touchcancel', () => snap('touchcancel'), { passive: true });
            doc.addEventListener('selectstart', () => snap('selectstart'), { passive: true });
            doc.addEventListener('contextmenu', () => snap('contextmenu'));
            let lastMove = 0;
            doc.addEventListener('touchmove', () => {
              const now = performance.now();
              if (now - lastMove > 500) { lastMove = now; snap('touchmove'); }
            }, { passive: true });
            // Sondeo del estado real de la selección: detecta selecciones que
            // existen aunque sus eventos nunca lleguen a este documento.
            let lastPoll = '';
            const pollId = setInterval(() => {
              const sel = doc.getSelection();
              const text = sel ? sel.toString().trim() : '';
              let rect = null;
              try { if (sel && sel.rangeCount) rect = rangeToViewportRect(sel.getRangeAt(0)); } catch { /* ignore */ }
              const state = `col=${sel ? sel.isCollapsed : '-'} len=${text.length} rect=${rect ? Math.round(rect.w) + 'x' + Math.round(rect.h) : 'null'}`;
              if (state !== lastPoll) { lastPoll = state; selDbg('poll: ' + state); }
            }, 500);
            cleanups.push(() => clearInterval(pollId));
          }

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
        cleanups.push(() => window.removeEventListener('resize', applyColumnCount));

        // Apply reader settings as CSS injected into the rendition.
        const settings = loadSettings();

        // Page turns are handled by foliate-js itself. The library's paginator
        // has a built-in sliding transition you opt into with the `animated`
        // attribute; we leave it off, so turns are instant (foliate's default).
        // No custom animation: the old hand-rolled fade/slide flickered because
        // it ran from the `relocate` event, which fires after foliate has already
        // painted the new page — any opacity/transform there just disturbs
        // content that is already on screen.
        view.style.display = 'block';
        view.style.width = '100%';
        view.style.height = '100%';
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

        // A `cfi` query param (e.g. from the all-annotations page) asks the
        // reader to jump straight to that passage, overriding saved progress.
        const targetCfi = searchParams.get('cfi');
        if (targetCfi) {
          try { await view.goTo(targetCfi); }
          catch {
            if (progress?.percentage != null) {
              try { await view.goToFraction(progress.percentage); } catch {}
            } else if (progress?.cfi) {
              try { await view.goTo(progress.cfi); } catch {}
            }
          }
        } else
        // Restore position. Prefer fraction over cfi: foliate-js's relocate cfi
        // points at the first visible element, which may start on the previous
        // spread when a paragraph wraps across pages — landing us one page back.
        // Fraction lands on the spread that contains the saved position.
        if (progress?.percentage != null) {
          try { await view.goToFraction(progress.percentage); }
          catch { if (progress.cfi) await view.goTo(progress.cfi); }
        } else if (progress?.cfi) {
          await view.goTo(progress.cfi);
        } else {
          // New book with no saved position: open() doesn't render any page, so
          // land on the first section (page 1 / the cover) instead of a blank.
          try { await view.goTo(0); } catch {}
        }

        setLoading(false);

        // Save on any relocate after a short grace period (lets the initial
        // restore complete first). Covers side buttons, keyboard, swipe and
        // TOC jumps — all of them go through the relocate event.
        let savingEnabled = false;
        setTimeout(() => { savingEnabled = true; }, 500);

        // Espeja los saltos del historial interno de foliate en el historial
        // del navegador: cada push (enlace, índice, anotación) añade una
        // entrada de la misma ruta con la profundidad en state. Todos los
        // "atrás" convergen en navigate(-1); el efecto sobre location deshace
        // el salto en foliate. Se conecta aquí, tras restaurar la posición
        // inicial, para no contar los push de la propia restauración.
        const onIndexChange = () => {
          if (!view.history.canGoBack) {
            jumpDepthRef.current = 0;
            setJumpDepth(0);
            return;
          }
          if (historyNavRef.current) return; // back()/forward() propio: ya sincronizado
          if (readingRef.current) return;    // goTo interno de la lectura en voz alta
          const depth = jumpDepthRef.current + 1;
          jumpDepthRef.current = depth;
          setJumpDepth(depth);
          setChipDismissed(false);
          navigate(window.location.pathname + window.location.search, { state: { jumpDepth: depth } });
        };
        view.history.addEventListener('index-change', onIndexChange);
        cleanups.push(() => view.history.removeEventListener('index-change', onIndexChange));

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
        // Flush first (save the latest position), then detach. Pushed eagerly so
        // an unmount mid-open still tears these down.
        cleanups.push(() => {
          try { flush(); } catch {}
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('pagehide', flush);
        });

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
        cleanups.push(() => document.removeEventListener('keydown', onKey));

        // Hardware volume buttons on Android (Capacitor): MainActivity hijacks
        // KEYCODE_VOLUME_UP/DOWN and dispatches a 'hardwareVolume' CustomEvent.
        const onVolume = (e) => {
          if (readingRef.current) return; // reading aloud: leave volume to the OS
          const which = e.detail;
          if (which === 'volumeUp') leftSideAdvances ? view.next() : view.prev();
          else if (which === 'volumeDown') leftSideAdvances ? view.prev() : view.next();
        };
        window.addEventListener('hardwareVolume', onVolume);
        cleanups.push(() => window.removeEventListener('hardwareVolume', onVolume));

        // SEL-DBG: ¿este motor reporta la selección del iframe con un
        // selectionchange en el documento padre en vez del propio iframe?
        if (seldbgOn()) {
          const topSel = () => {
            const s = document.getSelection();
            selDbg(`selchange:TOP rc=${s ? s.rangeCount : '-'} col=${s ? s.isCollapsed : '-'} len=${s ? s.toString().trim().length : 0}`);
          };
          document.addEventListener('selectionchange', topSel);
          cleanups.push(() => document.removeEventListener('selectionchange', topSel));
          // ¿Los toques aterrizan en la página padre en vez del iframe del
          // capítulo? (los eventos del iframe no burbujean hasta aquí)
          for (const ev of ['touchstart', 'touchend', 'touchcancel', 'pointerdown', 'pointerup', 'pointercancel']) {
            const h = () => selDbg('TOP:' + ev);
            window.addEventListener(ev, h, { capture: true, passive: true });
            cleanups.push(() => window.removeEventListener(ev, h, { capture: true }));
          }
        }
      } catch (e) {
        console.error('[reader] error', e);
        setError(e.message);
        setLoading(false);
      }
    }

    start();
    return () => {
      disposed = true;
      // Run every teardown collected during start(), regardless of how far it
      // got: this removes the window/document listeners even when we unmount
      // mid-open (no dependence on a handle assigned only at the end).
      for (const fn of cleanups) { try { fn(); } catch {} }
      // Tear down the view THIS run created (ownView), falling back to viewRef
      // for the synchronous case.
      const v = ownView || viewRef.current;
      if (v) {
        try { v.close?.(); } catch {}
        try { v.remove?.(); } catch {}
      }
      // Only null viewRef if it still points at our view, so a later mount's
      // view (set by the next StrictMode run) isn't clobbered by this cleanup.
      if (viewRef.current === v) viewRef.current = null;
    };
  }, [bookId, isShared]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Al entrar (o cambiar de libro) la pila de saltos empieza vacía; si la URL
  // trae state de una sesión previa (recarga, retorno desde la biblioteca), se
  // limpia para que el chip no aparezca sin salto real.
  useEffect(() => {
    jumpDepthRef.current = 0;
    setJumpDepth(0);
    setChipDismissed(false);
    if ((location.state?.jumpDepth ?? 0) !== 0) {
      navigate(window.location.pathname + window.location.search, { replace: true, state: { jumpDepth: 0 } });
    }
  }, [bookId]);

  // Cambio de entrada del router en la misma ruta (atrás/adelante del
  // navegador, navigate(-1) desde chip/flecha/gesto): la profundidad del state
  // manda y se aplica sobre el historial de foliate. El flag evita que
  // index-change vuelva a empujar entradas mientras deshacemos.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const stateDepth = location.state?.jumpDepth ?? 0;
    const current = jumpDepthRef.current;
    if (stateDepth === current) return;
    jumpDepthRef.current = stateDepth;
    setJumpDepth(stateDepth);
    historyNavRef.current = true;
    try {
      if (stateDepth < current) { for (let i = stateDepth; i < current; i++) view.history.back(); }
      else { for (let i = current; i < stateDepth; i++) view.history.forward(); }
    } finally { historyNavRef.current = false; }
  }, [location]);

  // Botón/gesto atrás de Android: con salto pendiente lo deshace y consume el
  // evento; si no, useNativeBack aplica su default (salir a la biblioteca).
  useEffect(() => {
    if (!isNative) return;
    return registerBackHandler(() => {
      if (jumpDepthRef.current > 0) { navigate(-1); return true; }
      return false;
    });
  }, [isNative, navigate]);

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
      if (Capacitor.isNativePlatform()) {
        // Native Android: open the device share sheet. The user cancelling the
        // sheet throws, so swallow it quietly.
        await Share.share({ text: selection.text, title });
      } else if (navigator.share) {
        await navigator.share({ text: selection.text, title });
      } else {
        await navigator.clipboard?.writeText(selection.text);
      }
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
    try { localStorage.removeItem('epubreader.readerPath'); } catch {}  // intentional exit: don't auto-restore
    navigate('/');
  };

  // Android can reload the WebView to '/' when the screen is off; remember this
  // book's route so App can reopen it on reload. Cleared on an intentional Back.
  useEffect(() => {
    if (!isNative) return;
    const path = window.location.pathname + window.location.search;
    const save = () => { try { localStorage.setItem('epubreader.readerPath', JSON.stringify({ path, t: Date.now() })); } catch {} };
    save();
    const id = setInterval(save, 20000);
    return () => clearInterval(id);
  }, [isNative]);

  const getView = useCallback(() => viewRef.current, []);

  const { reading, preparing, start: startReadAloud, stop: stopReadAloud, maxPages } =
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    'settings',
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
        <button className={styles.back}
          onClick={jumpDepth > 0 ? () => navigate(-1) : goBack}
          aria-label={jumpDepth > 0 ? 'Volver a la lectura' : 'Volver'}
          title={jumpDepth > 0 ? 'Volver a la lectura' : 'Volver'}>
          <ArrowLeft size={18} strokeWidth={2.75} />
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
          {reading ? <Square size={16} fill="currentColor" strokeWidth={0} /> : <Volume2 size={16} strokeWidth={2} />}
        </button>
        {/* On small web screens these collapse behind the toggle; desktop and
            Android (native) always show them inline. */}
        <div className={styles.collapsible}
          data-open={actionsOpen ? 'true' : 'false'}
          data-native={isNative ? 'true' : 'false'}>
          {toc.length > 0 && (
            <button className={styles.back} onClick={() => { setTocOpen(true); recordAction('toc'); }}
              aria-label="Índice de capítulos" title="Índice de capítulos">
              <Menu size={16} strokeWidth={2} />
            </button>
          )}
          {!isShared && (
            <button className={styles.back} onClick={() => { setAnnotationsOpen(true); recordAction('annotations'); }}
              aria-label="Subrayados" title="Subrayados">
              <Star size={16} strokeWidth={2} />
            </button>
          )}
          <button className={styles.back} onClick={() => { setSettingsOpen(true); recordAction('settings'); }}
            aria-label="Ajustes del lector" title="Ajustes del lector">
            <Settings size={16} strokeWidth={2} />
          </button>
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
        {preparing && <div className={styles.loading} style={{ background: 'var(--bg)' }}>Preparando lectura…</div>}
        {/* Side page-turn buttons: desktop web only. On mobile web they're
            hidden (CSS) so the whole page is free for text selection and
            page turns happen by swipe. Never rendered on native (Android). */}
        {!isNative && (
          <>
            <button className={`${styles.navBtn} ${styles.navPrev}`}
              aria-label={leftSideAdvances ? 'Siguiente' : 'Anterior'}
              onClick={onLeftSide}>‹</button>
            <button className={`${styles.navBtn} ${styles.navNext}`}
              aria-label={leftSideAdvances ? 'Anterior' : 'Siguiente'}
              onClick={onRightSide}>›</button>
          </>
        )}
        {jumpDepth > 0 && !chipDismissed && (
          <div className={styles.jumpBack} role="status">
            <button className={styles.jumpBackBtn} onClick={() => navigate(-1)}>
              <ArrowLeft size={14} strokeWidth={2.5} />
              Volver a la lectura
            </button>
            <button className={styles.jumpBackClose} onClick={() => setChipDismissed(true)} aria-label="Descartar">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
      {showOffHint && (
        <div className={styles.offHint} role="status">
          <span>Lectura detenida. Si desea escuchar con el dispositivo Android apagado, descargue la aplicación.</span>
          <button className={styles.offHintClose} onClick={() => setShowOffHint(false)} aria-label="Cerrar"><X size={18} strokeWidth={2} /></button>
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
              <button className={styles.back} onClick={() => setTocOpen(false)} aria-label="Cerrar"><X size={18} strokeWidth={2} /></button>
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
          onExplainAI={() => {
            if (!selection?.text) return;
            setAiText(selection.text);
            // Limpia la selección al abrir: los gatillos nativos se dibujan
            // por encima de cualquier modal mientras la selección siga viva.
            clearSelection();
          }}
        />
      )}
      <WiktionaryModal
        open={!!dictTerm}
        term={dictTerm || ''}
        lang={bookLang}
        onClose={() => { setDictTerm(null); clearSelection(); }}
      />
      <AIExplainModal text={aiText} title={title} author={author} onClose={() => { setAiText(null); clearSelection(); }} />
      <ReadAloudDialog
        open={readDialogOpen}
        maxPages={maxPages}
        onClose={() => setReadDialogOpen(false)}
        onStart={(pages) => { setReadDialogOpen(false); startReadAloud(pages); }}
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
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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

function ChevronIcon({ className }) {
  return <ChevronLeft className={className} size={16} strokeWidth={2.5} />;
}

function ActionIcon({ action }) {
  switch (action) {
    case 'toc':         return <Menu size={16} strokeWidth={2} />;
    case 'annotations': return <Star size={16} strokeWidth={2} />;
    case 'settings':    return <Settings size={16} strokeWidth={2} />;
    case 'fullscreen':  return <Maximize2 size={16} strokeWidth={2} />;
    default:            return null;
  }
}
