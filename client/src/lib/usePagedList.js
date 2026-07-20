import { useEffect, useMemo, useState } from 'react';

// Paginación presentacional: la lista completa vive en memoria y aquí solo se
// recorta la página visible. La página vigente se clampa al total, así que si
// la lista mengua (borrado, búsqueda) nunca quedas en una página vacía.
export function usePagedList(list, pageSize) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => list.slice((safePage - 1) * pageSize, safePage * pageSize),
    [list, safePage, pageSize],
  );
  return { page: safePage, setPage, pageCount, paged };
}

// 10 por página en móvil (breakpoint 640px del módulo de biblioteca), 20 en
// pantallas mayores.
export function usePageSize() {
  const calc = () => (window.innerWidth < 640 ? 10 : 20);
  const [size, setSize] = useState(calc);
  useEffect(() => {
    const onResize = () => setSize(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}
