import styles from './library.module.css';
import { usePagedList } from '../lib/usePagedList.js';

// Números visibles: primera, última y actual ±1; elipsis entre huecos.
function pageItems(page, pageCount) {
  const wanted = [...new Set([1, pageCount, page - 1, page, page + 1])]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of wanted) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

export default function Paginator({ page, pageCount, onPage }) {
  if (pageCount <= 1) return null;
  return (
    <nav className={styles.paginator} aria-label="Paginación">
      <button className={styles.pageBtn} disabled={page <= 1}
        onClick={() => onPage(page - 1)} aria-label="Página anterior">‹</button>
      {pageItems(page, pageCount).map((it, i) => it === '…' ? (
        <span key={`e${i}`} className={styles.pageEllipsis}>…</span>
      ) : (
        <button key={it} className={styles.pageBtn}
          data-current={it === page ? 'true' : undefined}
          aria-current={it === page ? 'page' : undefined}
          onClick={() => onPage(it)}>{it}</button>
      ))}
      <button className={styles.pageBtn} disabled={page >= pageCount}
        onClick={() => onPage(page + 1)} aria-label="Página siguiente">›</button>
    </nav>
  );
}

// Une usePagedList + Paginator para una sección: children(paged) pinta el
// listado y el paginador queda debajo. Una instancia por sección => estado
// propio, y las secciones dinámicas (grupos) no rompen la regla de hooks.
export function Paged({ list, pageSize, children }) {
  const { page, setPage, pageCount, paged } = usePagedList(list, pageSize);
  return (
    <>
      {children(paged)}
      <Paginator page={page} pageCount={pageCount} onPage={setPage} />
    </>
  );
}
