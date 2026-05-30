import { useEffect, useState } from 'react';
import styles from './annotations.module.css';

export default function NoteModal({ open, snippet, initialNote = '', onSave, onClose, onDelete, onJump }) {
  const [text, setText] = useState(initialNote);
  useEffect(() => { if (open) setText(initialNote); }, [open, initialNote]);
  if (!open) return null;
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <p className={styles.modalTitle}>Nota</p>
          <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className={styles.modalBody}>
          {snippet && <blockquote className={styles.drawerSnippet}>{snippet}</blockquote>}
          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe una nota sobre este pasaje…"
            autoFocus
          />
        </div>
        <footer className={styles.modalFooter}>
          {onDelete && <button className={styles.btnDanger} onClick={onDelete}>Eliminar subrayado</button>}
          {onJump && <button className={styles.btnSecondary} onClick={onJump}>Ir al pasaje</button>}
          <button className={styles.btnSecondary} onClick={onClose}>Cancelar</button>
          <button className={styles.btnPrimary} onClick={() => onSave(text)}>Guardar</button>
        </footer>
      </div>
    </div>
  );
}
