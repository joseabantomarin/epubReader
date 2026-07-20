# Paginación de la biblioteca — Diseño

**Fecha:** 2026-07-19
**Objetivo:** Paginar los listados de libros de la biblioteca con un paginador clásico de números: 10 por página en móvil (ventana < 640px, el breakpoint existente) y 20 en adelante en pantallas mayores.

## Alcance

- Aplica a todas las secciones de libros de la portada: **Mis Libros**, **Libros Compartidos** (vitrina), cada **sección de grupo** y **Compartido conmigo**. Cada sección pagina por separado con su propio estado.
- Paginación **puramente presentacional**: los datos siguen llegando completos del API y el caché offline no cambia. Sin cambios de servidor.
- La búsqueda sigue filtrando sobre la lista completa (no solo la página visible).
- El paginador no se muestra cuando la sección cabe en una página.

Fuera de alcance (YAGNI): paginación en el servidor, persistir la página actual entre visitas, paginar la página de subrayados o las vistas de grupo.

## Componentes

### 1. `client/src/lib/usePagedList.js` (nuevo)

- `usePagedList(list, pageSize)` → `{ page, setPage, pageCount, paged }`. `pageCount = max(1, ceil(len/pageSize))`; la página vigente se **clampa** a `pageCount` (si la lista mengua por borrado o búsqueda, caes en la última página válida — nunca en una vacía).
- `usePageSize()` → `10` si `window.innerWidth < 640`, si no `20`; escucha `resize`.

### 2. `client/src/library/Paginator.jsx` (nuevo)

- Default export `Paginator({ page, pageCount, onPage })`: `‹ 1 … 4 5 6 … 12 ›`. Números visibles: 1, última, actual ±1; elipsis entre huecos. Botones ‹/› deshabilitados en los extremos; página actual con `aria-current="page"` y estilo destacado. Devuelve `null` con `pageCount <= 1`.
- Named export `Paged({ list, pageSize, children })`: wrapper render-prop que une `usePagedList` + `Paginator` — `children(paged)` pinta el grid y el paginador va debajo. Resuelve además la regla de hooks para las secciones de grupo (cantidad dinámica: cada instancia del componente tiene su propio estado).

### 3. `client/src/library/LibraryPage.jsx` (modificar)

- `const pageSize = usePageSize();` y cada sección envuelve su listado en `<Paged list={…} pageSize={pageSize}>`: Mis Libros (el `div` grid/list con `BookCard`), vitrina (`SharedShelf` con `sharedFiltered`), grupos (`SharedShelf` con `g.books`) y Compartido conmigo (`SharedShelf` con `sharedWithMe`).

### 4. Estilos (`client/src/library/library.module.css`)

- `.paginator` (fila centrada bajo el grid), `.pageBtn` (botón numérico, estado actual destacado, deshabilitado atenuado) y `.pageEllipsis`. Coherentes con los estilos y modo oscuro existentes del módulo.

## Casos borde

- **Lista mengua** (borrar libros, filtrar): el clamp te deja en la última página válida; nunca una página vacía.
- **Cambio móvil↔escritorio** (resize cruza 640px): cambia el tamaño de página y la página vigente se re-clampa.
- **Búsqueda**: al filtrar, las listas cortas colapsan a una página y el paginador desaparece; al limpiar la búsqueda reaparece.
- **Modo lista vs grid**: la paginación es independiente del modo de vista.
- **Selección múltiple** (modo selección de Mis Libros): opera sobre los libros visibles de la página actual; "eliminar/compartir seleccionados" sigue funcionando igual.

## Pruebas

- **`usePagedList`** (renderHook): recorte correcto de la página 1 y 2; `pageCount` con lista vacía (=1); clamp cuando la lista mengua estando en la última página.
- **`Paginator`** (testing-library): `null` con una página; números y elipsis correctos (p. ej. página 5 de 12 → `‹ 1 … 4 5 6 … 12 ›`); clic en número y en ‹/› llama `onPage`; extremos deshabilitados.
- **Manual:** móvil (10 en 10) y escritorio (20 en 20) en las cuatro secciones; búsqueda y borrado con clamp.
