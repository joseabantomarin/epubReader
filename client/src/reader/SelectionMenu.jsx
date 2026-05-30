import styles from './annotations.module.css';

// Floating menu rendered while text is selected. Position is in viewport (fixed)
// coordinates and is computed by the parent from the selection's bounding rect.
export default function SelectionMenu({
  pos, existingId, onDictionary, onHighlight, onNote, onCopy, onShare, onDelete,
}) {
  if (!pos) return null;
  const style = { left: pos.x, top: pos.y };
  return (
    <div className={styles.menu} style={style} role="menu" onMouseDown={(e) => e.preventDefault()}>
      <button className={styles.menuBtn} onClick={onDictionary}>Diccionario</button>
      {!existingId && <button className={styles.menuBtn} onClick={onHighlight}>Subrayar</button>}
      <button className={styles.menuBtn} onClick={onNote}>{existingId ? 'Nota' : 'Nota'}</button>
      <button className={styles.menuBtn} onClick={onCopy}>Copiar</button>
      <button className={styles.menuBtn} onClick={onShare}>Compartir</button>
      {existingId && <button className={styles.menuBtn} onClick={onDelete}>Eliminar</button>}
    </div>
  );
}
