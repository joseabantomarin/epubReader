# Paginación de la biblioteca — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paginador clásico de números en las cuatro secciones de libros de la biblioteca: 10 por página en móvil (< 640px), 20 en escritorio.

**Architecture:** Paginación presentacional en el cliente: hook `usePagedList` (recorte + clamp) y `usePageSize` (responsivo), componente `Paginator` (números con elipsis) y wrapper render-prop `Paged` que los une — una instancia por sección resuelve el estado independiente y la regla de hooks con secciones dinámicas. Sin cambios de servidor. Spec: `docs/superpowers/specs/2026-07-19-library-pagination-design.md`.

**Tech Stack:** React 18, vitest + @testing-library (config en `client/vite.config.js`, globals activos), CSS modules.

## Global Constraints

- Tamaños de página: `window.innerWidth < 640` → 10; si no → 20 (breakpoint existente del módulo).
- El paginador no se renderiza con `pageCount <= 1`.
- Sin dependencias nuevas; UI en español; variables CSS existentes (`--accent`, `--border`, `--fg`, `--muted`, `--card`, `--bg`).
- Comandos desde `client/`: `npm test`, `npm run build`. Verificar exit code real (no enmascararlo con grep).
- Commits convencionales terminados con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- El APK público sale del release del CI (`gh release download vX.Y --pattern '*.apk'`), NUNCA del build local (OPS.md).

---

### Task 1: `usePagedList` + `usePageSize` (TDD)

**Files:**
- Create: `client/src/lib/usePagedList.js`
- Test: `client/src/lib/usePagedList.test.js`

**Interfaces:**
- Produces: `usePagedList(list: Array, pageSize: number)` → `{ page, setPage, pageCount, paged }` (con clamp: `page` nunca excede `pageCount`); `usePageSize()` → `10 | 20` según `window.innerWidth < 640`, reactivo a `resize`. Los consume la Task 2/3.

- [ ] **Step 1: Test que falla** — `client/src/lib/usePagedList.test.js`:

```js
import { renderHook, act } from '@testing-library/react';
import { usePagedList, usePageSize } from './usePagedList.js';

const LIST = Array.from({ length: 25 }, (_, i) => i + 1);

describe('usePagedList', () => {
  it('recorta la primera página', () => {
    const { result } = renderHook(() => usePagedList(LIST, 10));
    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.paged).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('cambia de página con setPage', () => {
    const { result } = renderHook(() => usePagedList(LIST, 10));
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    expect(result.current.paged).toEqual([21, 22, 23, 24, 25]);
  });

  it('lista vacía: una página vacía', () => {
    const { result } = renderHook(() => usePagedList([], 10));
    expect(result.current.pageCount).toBe(1);
    expect(result.current.paged).toEqual([]);
  });

  it('clampa la página cuando la lista mengua', () => {
    const { result, rerender } = renderHook(({ list }) => usePagedList(list, 10), {
      initialProps: { list: LIST },
    });
    act(() => result.current.setPage(3));
    rerender({ list: LIST.slice(0, 12) });
    expect(result.current.page).toBe(2);
    expect(result.current.paged).toEqual([11, 12]);
  });
});

describe('usePageSize', () => {
  it('10 bajo 640px, 20 en adelante, reactivo a resize', () => {
    window.innerWidth = 500;
    const { result } = renderHook(() => usePageSize());
    expect(result.current).toBe(10);
    act(() => {
      window.innerWidth = 1024;
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(20);
  });
});
```

- [ ] **Step 2: Verificar fallo** — Run: `cd client && npx vitest run src/lib/usePagedList.test.js` — Expected: FAIL (no resuelve `./usePagedList.js`).

- [ ] **Step 3: Implementación** — `client/src/lib/usePagedList.js`:

```js
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
```

- [ ] **Step 4: Verificar éxito** — Run: `cd client && npx vitest run src/lib/usePagedList.test.js` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/usePagedList.js client/src/lib/usePagedList.test.js
git commit -m "feat(lib): add usePagedList and responsive usePageSize hooks"
```

---

### Task 2: `Paginator` + wrapper `Paged` (TDD)

**Files:**
- Create: `client/src/library/Paginator.jsx`
- Modify: `client/src/library/library.module.css` (añadir al final)
- Test: `client/src/library/Paginator.test.jsx`

**Interfaces:**
- Consumes: `usePagedList` de Task 1.
- Produces: default `Paginator({ page, pageCount, onPage })`; named `Paged({ list, pageSize, children })` donde `children` es `(paged: Array) => JSX`. Los consume Task 3.

- [ ] **Step 1: Test que falla** — `client/src/library/Paginator.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import Paginator, { Paged } from './Paginator.jsx';

describe('Paginator', () => {
  it('null con una sola página', () => {
    const { container } = render(<Paginator page={1} pageCount={1} onPage={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('página 5 de 12: 1 … 4 5 6 … 12', () => {
    render(<Paginator page={5} pageCount={12} onPage={() => {}} />);
    const texts = [...screen.getByRole('navigation').querySelectorAll('button,span')].map((el) => el.textContent);
    expect(texts).toEqual(['‹', '1', '…', '4', '5', '6', '…', '12', '›']);
    expect(screen.getByText('5').getAttribute('aria-current')).toBe('page');
  });

  it('clic en número y en flechas llama onPage', () => {
    const onPage = vi.fn();
    render(<Paginator page={2} pageCount={3} onPage={onPage} />);
    fireEvent.click(screen.getByText('3'));
    expect(onPage).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByLabelText('Página anterior'));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it('extremos deshabilitados', () => {
    render(<Paginator page={1} pageCount={3} onPage={() => {}} />);
    expect(screen.getByLabelText('Página anterior')).toBeDisabled();
    expect(screen.getByLabelText('Página siguiente')).not.toBeDisabled();
  });
});

describe('Paged', () => {
  it('pinta la página y navega', () => {
    const list = Array.from({ length: 15 }, (_, i) => `L${i + 1}`);
    render(
      <Paged list={list} pageSize={10}>
        {(paged) => <ul>{paged.map((x) => <li key={x}>{x}</li>)}</ul>}
      </Paged>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByText('2'));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('L15')).toBeTruthy();
  });
});
```

Nota: `toBeDisabled` viene de `@testing-library/jest-dom`; si no hay setup global, comprobar `expect(btn.disabled).toBe(true)` en su lugar.

- [ ] **Step 2: Verificar fallo** — Run: `cd client && npx vitest run src/library/Paginator.test.jsx` — Expected: FAIL (no resuelve `./Paginator.jsx`).

- [ ] **Step 3: Implementación** — `client/src/library/Paginator.jsx`:

```jsx
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
```

Al final de `client/src/library/library.module.css`:

```css
/* Paginador de secciones de libros. */
.paginator {
  display: flex; justify-content: center; align-items: center;
  gap: 6px; margin: 14px 0 4px; flex-wrap: wrap;
}
.pageBtn {
  min-width: 34px; height: 34px; padding: 0 8px;
  border: 1px solid var(--border); background: transparent;
  border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--fg);
}
.pageBtn:disabled { opacity: .4; cursor: default; }
.pageBtn[data-current='true'] { background: var(--accent); color: #fff; border-color: transparent; }
.pageEllipsis { padding: 0 2px; color: var(--muted); }
```

- [ ] **Step 4: Verificar éxito** — Run: `cd client && npx vitest run src/library/Paginator.test.jsx` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/library/Paginator.jsx client/src/library/Paginator.test.jsx client/src/library/library.module.css
git commit -m "feat(library): add Paginator component and Paged wrapper"
```

---

### Task 3: Integración en `LibraryPage`

**Files:**
- Modify: `client/src/library/LibraryPage.jsx`

**Interfaces:**
- Consumes: `Paged` de Task 2 y `usePageSize` de Task 1.

- [ ] **Step 1: Imports y tamaño** — añadir:

```js
import { Paged } from './Paginator.jsx';
import { usePageSize } from '../lib/usePagedList.js';
```

y dentro del componente, junto a los otros hooks: `const pageSize = usePageSize();`

- [ ] **Step 2: Mis Libros** — envolver el grid actual:

```jsx
              <Paged list={filtered} pageSize={pageSize}>
                {(paged) => (
                  <div className={viewMode === 'list' ? styles.list : styles.grid}>
                    {paged.map((b) => (
                      <BookCard key={b.id} book={b} selectionMode={selectionMode}
                        selected={selectedIds.has(b.id)} onActivate={onActivate}
                        onGestureSelect={() => selectFromGesture(b.id)}
                        onRate={(s) => rateBook(b.id, s)} onClear={() => clearBookRating(b.id)} />
                    ))}
                  </div>
                )}
              </Paged>
```

- [ ] **Step 3: Vitrina, grupos y compartido conmigo** — mismas envolturas:

```jsx
        <Paged list={sharedFiltered} pageSize={pageSize}>
          {(paged) => (
            <SharedShelf books={paged} canRate={!isGuest} onOpen={openShared}
              isAdmin={!!user?.isAdmin} onCensor={censorShared} viewMode={viewMode} />
          )}
        </Paged>
```

```jsx
          <Paged list={g.books} pageSize={pageSize}>
            {(paged) => <SharedShelf books={paged} canRate={false} onOpen={openShared} viewMode={viewMode} />}
          </Paged>
```

```jsx
          <Paged list={sharedWithMe} pageSize={pageSize}>
            {(paged) => (
              <SharedShelf books={paged} canRate={false} onOpen={openShared} viewMode={viewMode} />
            )}
          </Paged>
```

- [ ] **Step 4: Verificar** — Run: `cd client && npm test && npm run build` (exit real) — Expected: PASS + build OK.

- [ ] **Step 5: Commit**

```bash
git add client/src/library/LibraryPage.jsx
git commit -m "feat(library): paginate book sections (10 mobile / 20 desktop)"
```

---

### Task 4: Deploy web

- [ ] **Step 1:** `git push` y en el server: `ssh administrator@147.93.176.249 'cd ~/epubReader && git pull && cd client && npm run build'`.
- [ ] **Step 2:** Verificar que `https://mislibros.openlinks.app/` sirve el bundle nuevo (hash de `assets/index-*.js` igual al build local). Cambio solo de frontend: sin restart.

### Task 5: APK público desde el CI

- [ ] **Step 1:** Esperar a que el workflow del push cree el release nuevo (`gh release list` hasta ver el tag siguiente con el APK adjunto).
- [ ] **Step 2:** `gh release download <tag-nuevo> --pattern '*.apk' --dir <scratch>` y `scp` al server como `/home/administrator/epubReader/server/data/downloads/mislibros.apk`.
- [ ] **Step 3:** Verificar SHA-256 local vs server idénticos y `curl -sI .../downloads/mislibros.apk` → 200. (APK del CI: firma registrada en OAuth; el build local NO sirve — OPS.md.)
