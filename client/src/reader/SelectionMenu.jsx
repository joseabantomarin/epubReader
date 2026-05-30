import { useLayoutEffect, useRef, useState } from 'react';
import styles from './annotations.module.css';

// Floating menu rendered while text is selected. Position is in viewport (fixed)
// coordinates and is computed by the parent from the selection's bounding rect.
// We measure the menu and clamp it to the viewport so it never spills off-screen
// when the selection sits near the left/right (or bottom) edge.
export default function SelectionMenu({
  pos, existingId, onDictionary, onHighlight, onNote, onCopy, onShare, onDelete, onExplainAI, showAI,
}) {
  const ref = useRef(null);
  const [adj, setAdj] = useState(null);

  useLayoutEffect(() => {
    if (!pos || !ref.current) { setAdj(null); return; }
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const m = 8; // viewport margin
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(m, Math.min(pos.x - w / 2, vw - w - m));
    const top = Math.max(m, Math.min(pos.y, vh - h - m));
    setAdj({ left, top });
  }, [pos?.x, pos?.y]);

  if (!pos) return null;

  // Before measuring, render centered on pos via the CSS transform; once
  // measured, use the clamped top-left and drop the centering transform.
  const style = adj
    ? { left: adj.left, top: adj.top, transform: 'none' }
    : { left: pos.x, top: pos.y };

  return (
    <div ref={ref} className={styles.menu} style={style} role="menu" onMouseDown={(e) => e.preventDefault()}>
      <button className={styles.menuBtn} onClick={onDictionary}>Diccionario</button>
      {showAI && <button className={styles.menuBtn} onClick={onExplainAI}>IA</button>}
      {!existingId && <button className={styles.menuBtn} onClick={onHighlight}>Subrayar</button>}
      <button className={styles.menuBtn} onClick={onNote}>{existingId ? 'Nota' : 'Nota'}</button>
      <button className={styles.menuBtn} onClick={onCopy}>Copiar</button>
      <button className={styles.menuBtn} onClick={onShare}>Compartir</button>
      {existingId && <button className={styles.menuBtn} onClick={onDelete}>Eliminar</button>}
    </div>
  );
}
