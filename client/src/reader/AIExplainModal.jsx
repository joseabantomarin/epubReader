import { useEffect, useState } from 'react';
import styles from './annotations.module.css';
import { api } from '../lib/api.js';

// Shows a Groq explanation of the given text. `text` non-null = open.
// The book title/author are prepended so the AI has context about the source:
// "Libro <título> <autor>: <texto seleccionado>".
export default function AIExplainModal({ text, title, author, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, explanation: '' });

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    setState({ loading: true, error: null, explanation: '' });
    const context = ['Libro', title, author].filter(Boolean).join(' ');
    const query = `${context}: ${text}`;
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
