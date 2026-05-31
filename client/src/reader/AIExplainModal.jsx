import { useEffect, useRef, useState } from 'react';
import styles from './annotations.module.css';
import { api } from '../lib/api.js';

// Mini-chat over the selected text. Opening it (text non-null) fires a first
// request framing the fragment with the book's title/author; the model explains
// from the text itself, or just defines the word(s) when there's little context.
// The user can then keep asking follow-ups — the whole conversation is sent each
// turn so answers build on the previous ones.
export default function AIExplainModal({ text, title, author, onClose }) {
  // messages[0] is the hidden framing prompt; the rest is the visible chat.
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [input, setInput] = useState('');
  const bodyRef = useRef(null);

  // Fire the first request when opened.
  useEffect(() => {
    if (!text) { setMessages([]); setInput(''); setError(null); setLoading(false); return; }
    const ref = author ? `(del libro «${title}» de ${author})` : `(del libro «${title}»)`;
    const initial = `Explica con claridad y algo de detalle (uno o dos párrafos) el siguiente `
      + `fragmento ${ref}, basándote en el propio texto. Si no hay suficiente contexto para `
      + `explicarlo, define directamente la(s) palabra(s), sin avisar que falta contexto y sin `
      + `disculparte. No menciones si conoces o no el libro y responde directo, sin preámbulos. `
      + `Fragmento: «${text}»`;
    const convo = [{ role: 'user', content: initial }];
    setMessages(convo);
    runTurn(convo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // Keep the latest message in view.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, loading]);

  const runTurn = async (convo) => {
    setLoading(true);
    setError(null);
    try {
      const { explanation } = await api.explainWithAI(convo);
      setMessages([...convo, { role: 'assistant', content: explanation }]);
    } catch {
      setError('No se pudo consultar la IA.');
    } finally {
      setLoading(false);
    }
  };

  const onSend = () => {
    const q = input.trim();
    if (!q || loading) return;
    const convo = [...messages, { role: 'user', content: q }];
    setMessages(convo);
    setInput('');
    runTurn(convo);
  };

  if (!text) return null;

  const visible = messages.filter((_, i) => i !== 0); // hide the framing prompt

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <p className={styles.modalTitle}>Explicación (IA)</p>
          <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className={styles.chatBody} ref={bodyRef}>
          {visible.map((m, i) => (
            <div
              key={i}
              className={`${styles.chatMsg} ${m.role === 'user' ? styles.chatUser : styles.chatAI}`}
            >
              {m.content}
            </div>
          ))}
          {loading && <div className={`${styles.chatMsg} ${styles.chatAI}`}>Consultando…</div>}
          {error && <p className={styles.dictEmpty}>{error}</p>}
        </div>

        <div className={styles.chatInputRow}>
          <textarea
            className={styles.chatInput}
            rows={1}
            placeholder="Pregunta algo más…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          />
          <button className={styles.btnPrimary} onClick={onSend} disabled={loading || !input.trim()}>
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
