import { useEffect, useRef, useState } from 'react';
import styles from './library.module.css';
import { bookCoverUrl, sharedCoverUrl, getToken } from '../lib/api.js';
import { getCover, putCover } from '../lib/offlineCache.js';
import { percent, relativeTime } from '../lib/format.js';
import StarRating from './StarRating.jsx';

function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 50% 45%)`;
}

export default function BookCard({ book, selectionMode, selected, onActivate, shared = false, onRate, onClear, onGestureSelect }) {
  const [coverSrc, setCoverSrc] = useState(null);

  // Gesture handling: long-press (touch) or double-click (mouse) enters
  // selection mode via onGestureSelect, while a plain click/tap still opens
  // the book. On mouse we defer the open briefly to detect a double-click.
  const clickTimer = useRef(null);
  const pressTimer = useRef(null);
  const suppressClick = useRef(false);
  const isTouch = useRef(false);

  useEffect(() => () => {
    clearTimeout(clickTimer.current);
    clearTimeout(pressTimer.current);
  }, []);

  const open = () => onActivate(book);

  const handleClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    // In selection mode (or without a gesture handler) a click acts immediately.
    if (selectionMode || !onGestureSelect || isTouch.current) { open(); return; }
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => { clickTimer.current = null; open(); }, 220);
  };

  const handleDoubleClick = () => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    onGestureSelect?.();
  };

  const onTouchStart = () => {
    isTouch.current = true;
    if (selectionMode || !onGestureSelect) return;
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      suppressClick.current = true; // swallow the click that follows touchend
      onGestureSelect?.();
    }, 500);
  };
  const endPress = () => { clearTimeout(pressTimer.current); pressTimer.current = null; };

  // Always display the cover from a blob URL — `<img src>` to a relative
  // path doesn't work inside Capacitor (the webview origin is localhost),
  // but fetch is intercepted by CapacitorHttp and reaches the real server.
  useEffect(() => {
    if (!book.coverUrl) { setCoverSrc(null); return; }
    let cancelled = false;
    let createdUrl = null;
    const show = (blob) => {
      if (cancelled) return;
      createdUrl = URL.createObjectURL(blob);
      setCoverSrc(createdUrl);
    };
    (async () => {
      const cached = await getCover(book.id);
      if (cached) { show(cached); return; }
      try {
        const url = shared ? sharedCoverUrl(book.id) : bookCoverUrl(book.id);
        const headers = shared ? {} : { Authorization: `Bearer ${getToken()}` };
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const blob = await res.blob();
        putCover(book.id, blob).catch(() => {});
        show(blob);
      } catch { /* offline or other failure — silent */ }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [book.id, book.coverUrl, shared]);

  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      onClick={handleClick}
      onDoubleClick={onGestureSelect ? handleDoubleClick : undefined}
      onTouchStart={onGestureSelect ? onTouchStart : undefined}
      onTouchEnd={onGestureSelect ? endPress : undefined}
      onTouchMove={onGestureSelect ? endPress : undefined}
      onContextMenu={onGestureSelect ? (e) => e.preventDefault() : undefined}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
    >
      <div className={styles.cover} style={{ background: hashColor(book.title || 'x') }}>
        {coverSrc ? (
          <img src={coverSrc} alt="" loading="lazy" draggable={false} />
        ) : (
          <div className={styles.coverFallback}>
            <strong>{book.title}</strong>
            {book.author && <span>{book.author}</span>}
          </div>
        )}
        {book.format && (
          <span className={`${styles.formatBadge} ${book.format === 'pdf' ? styles.badgePdf : styles.badgeEpub}`}>
            {book.format.toUpperCase()}
          </span>
        )}
        {book.isOffline && (
          <span className={styles.offlineDot} title="Disponible offline" aria-label="Disponible offline" />
        )}
        {book.shared ? (
          <span className={styles.sharedBadge} title="Compartido" aria-label="Compartido">🔗</span>
        ) : null}
        {selectionMode && (
          <div className={styles.checkbox} aria-hidden>{selected ? '✓' : ''}</div>
        )}
      </div>
      <p className={styles.cardTitle}>{book.title}</p>
      <p className={styles.cardAuthor}>{book.author || '—'}</p>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: percent(book.percentage) }} />
      </div>
      <div className={styles.cardMeta}>
        <span>{percent(book.percentage)}</span>
        <span>{relativeTime(book.lastReadAt)}</span>
      </div>
      {onRate && (
        <StarRating
          avg={book.avgStars}
          count={book.ratingCount}
          myStars={book.myStars}
          interactive
          onRate={onRate}
          onClear={onClear}
        />
      )}
    </div>
  );
}
