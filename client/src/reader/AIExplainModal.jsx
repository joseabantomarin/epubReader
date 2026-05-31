import { useEffect, useState } from 'react';
import styles from './annotations.module.css';
import { api } from '../lib/api.js';

// Shows a Groq explanation of the given text. `text` non-null = open.
// A short selection (1-2 words) is treated as a word to define; anything longer
// is treated as a passage to explain, framed with the book's title/author.
export default function AIExplainModal({ text, title, author, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, explanation: '' });

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    setState({ loading: true, error: null, explanation: '' });
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    let query;
    if (wordCount <= 2) {
      query = `Define esto: "${text}"`;
    } else {
      const book = author ? `del libro ${title} del autor ${author}` : `del libro ${title}`;
      query = `Explica este pasaje ${book}: ${text}`;
    }
    (async () => {
      try {
        const { explanation } = await api.explainWithAI(query);
        if (!cancelled) setState({ loading: false, error: null, explanation });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: 'No se pudo consultar la IA.', explanation: '' });
      }
    })();
    return () => { cancelled = true; };
  }, [text, title, author]);

  if (!text) return null;
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <p className={styles.dictWord}>Explicación (IA)</p>
          <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className={styles.modalBody}>
          {state.loading && <p>Consultando…</p>}
          {!state.loading && state.error && <p className={styles.dictEmpty}>{state.error}</p>}
          {!state.loading && !state.error && (
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{state.explanation}</p>
          )}
        </div>
      </div>
    </div>
  );
}
