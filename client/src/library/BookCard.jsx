import { useEffect, useState } from 'react';
import styles from './library.module.css';
import { bookCoverUrl, getToken } from '../lib/api.js';
import { getCover, putCover } from '../lib/offlineCache.js';
import { percent, relativeTime } from '../lib/format.js';

function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 50% 45%)`;
}

export default function BookCard({ book, selectionMode, selected, onActivate }) {
  const handleClick = () => onActivate(book);
  const [coverSrc, setCoverSrc] = useState(null);

  // Cache-first cover: blob URL from IndexedDB if present, else server URL +
  // store in background. Survives offline reloads.
  useEffect(() => {
    if (!book.coverUrl) { setCoverSrc(null); return; }
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      const cached = await getCover(book.id);
      if (cached && !cancelled) {
        createdUrl = URL.createObjectURL(cached);
        setCoverSrc(createdUrl);
        return;
      }
      const serverUrl = bookCoverUrl(book.id);
      if (!cancelled) setCoverSrc(serverUrl);
      try {
        const res = await fetch(serverUrl, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const blob = await res.blob();
          await putCover(book.id, blob);
        }
      } catch { /* offline or other failure — silent */ }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [book.id, book.coverUrl]);

  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
    >
      <div className={styles.cover} style={{ background: hashColor(book.title || 'x') }}>
        {coverSrc ? (
          <img src={coverSrc} alt="" loading="lazy" />
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
    </div>
  );
}
