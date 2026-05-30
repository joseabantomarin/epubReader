import { useEffect, useState } from 'react';
import styles from './annotations.module.css';

// Small dialog asking how many pages to read aloud. Replaces window.prompt,
// which is unreliable in the Android WebView and showed no default value.
export default function ReadAloudDialog({ open, onClose, onStart, maxPages = 100 }) {
  const [pages, setPages] = useState('5');

  useEffect(() => { if (open) setPages('5'); }, [open]);

  if (!open) return null;

  const submit = () => {
    const n = Math.max(1, Math.min(maxPages, Math.round(Number(pages) || 5)));
    onStart(n);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <p className={styles.dictWord}>Leer en voz alta</p>
          <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className={styles.modalBody}>
          <label style={{ display: 'block', marginBottom: 10 }}>
            ¿Cuántas páginas leer? (máx. {maxPages})
            <input
              type="number" min="1" max={maxPages} inputMode="numeric"
              value={pages}
              onChange={(e) => setPages(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              autoFocus
              style={{ display: 'block', marginTop: 6, width: '100%', padding: '8px 10px', fontSize: 16, boxSizing: 'border-box' }}
            />
          </label>
          <button className={styles.btnSecondary} onClick={submit}>Empezar</button>
        </div>
      </div>
    </div>
  );
}
