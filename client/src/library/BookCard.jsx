import styles from './library.module.css';
import { bookCoverUrl } from '../lib/api.js';
import { percent, relativeTime } from '../lib/format.js';

function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 50% 45%)`;
}

export default function BookCard({ book, selectionMode, selected, onActivate }) {
  const handleClick = () => onActivate(book);
  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
    >
      <div className={styles.cover} style={{ background: hashColor(book.title || 'x') }}>
        {book.coverUrl ? (
          <img src={bookCoverUrl(book.id)} alt="" loading="lazy" />
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
