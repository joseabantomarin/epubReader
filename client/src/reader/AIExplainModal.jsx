import { useEffect, useState } from 'react';
import styles from './annotations.module.css';
import { api } from '../lib/api.js';

// Shows a Groq explanation of the given text. `text` non-null = open.
// The model explains the fragment from the text itself (the book/author are just
// light context), and falls back to defining the word(s) when there's too little
// context. It's told not to disclaim about (not) knowing the book.
export default function AIExplainModal({ text, title, author, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, explanation: '' });

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    setState({ loading: true, error: null, explanation: '' });
    const ref = author ? `(del libro «${title}» de ${author})` : `(del libro «${title}»)`;
    const query = `Explica de forma breve y clara el siguiente fragmento ${ref}, basándote únicamente en el propio texto. Si el fragmento es demasiado corto o no aporta contexto suficiente, limítate a dar la definición de la(s) palabra(s). No menciones si conoces o no el libro. Fragmento: «${text}»`;
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
