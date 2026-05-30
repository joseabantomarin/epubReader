import styles from './annotations.module.css';

export default function AnnotationsDrawer({ open, annotations, onJump, onClose }) {
  if (!open) return null;
  return (
    <aside className={styles.drawer} role="dialog" aria-label="Subrayados">
      <header className={styles.drawerHeader}>
        <p className={styles.drawerTitle}>Subrayados ({annotations.length})</p>
        <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">×</button>
      </header>
      {annotations.length === 0 ? (
        <p className={styles.drawerEmpty}>Aún no tienes subrayados en este libro.</p>
      ) : (
        <ul className={styles.drawerList}>
          {annotations.map(a => {
            const meta = [a.chapter, a.page ? `pág ${a.page}` : null].filter(Boolean).join(' · ');
            return (
              <li key={a.id} className={styles.drawerItem} onClick={() => onJump(a)}>
                <p className={styles.drawerSnippet} style={{ borderLeftColor: a.color || '#ffd400' }}>
                  {a.text || '(sin texto)'}
                </p>
                {a.note && <p className={styles.drawerNote}>{a.note}</p>}
                {meta && <p className={styles.drawerMeta}>{meta}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
