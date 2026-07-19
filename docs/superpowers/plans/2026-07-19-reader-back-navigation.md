# Volver a la posición de lectura tras un salto — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deshacer saltos de posición en el lector (enlaces, índice, anotaciones) con el botón atrás de Android, el atrás del navegador, un chip flotante y la flecha del encabezado.

**Architecture:** El historial interno de foliate-js (`view.history`) es la fuente de verdad; cada push se espeja como entrada del router (`/read/:id` con `state.jumpDepth`). Todos los disparadores de "atrás" convergen en `navigate(-1)`; un efecto detecta el cambio de profundidad y llama `view.history.back()`/`forward()`. Spec: `docs/superpowers/specs/2026-07-19-reader-back-navigation-design.md`.

**Tech Stack:** React 18, react-router-dom 6, Capacitor 8 (`@capacitor/app`), foliate-js vendoreado en `client/public/foliate-js/`, vitest + jsdom (config en `client/vite.config.js`).

## Global Constraints

- Textos de UI en español: chip «Volver a la lectura», botón de descarte aria-label «Descartar», flecha con aria-label «Volver a la lectura» (con salto) / «Volver» (sin salto).
- Sin dependencias nuevas.
- Los listeners dentro del efecto principal de `ReaderPage` se limpian vía el arreglo `cleanups` existente; los efectos nuevos devuelven su propia limpieza.
- Comandos de test/build se ejecutan desde `client/`: `npm test` (vitest run), `npm run build`.
- Commits estilo convencional del repo (`feat(lib): …`, `feat(reader): …`) terminados con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No tocar el overlay de diagnóstico `selDbg` (WIP sin commitear en `ReaderPage.jsx`).

---

### Task 1: Registro de handlers para el botón atrás nativo

**Files:**
- Create: `client/src/lib/backActions.js`
- Test: `client/src/lib/backActions.test.js`

**Interfaces:**
- Produces: `registerBackHandler(fn: () => boolean): () => void` (devuelve la función para desregistrar) y `tryBackHandlers(): boolean` (true si algún handler manejó el evento). Los consumen las Tasks 2 y 3.

- [ ] **Step 1: Escribir el test que falla**

`client/src/lib/backActions.test.js` (vitest con `globals: true`: `describe`/`it`/`expect`/`vi` son globales):

```js
import { registerBackHandler, tryBackHandlers } from './backActions.js';

describe('backActions', () => {
  it('sin handlers devuelve false', () => {
    expect(tryBackHandlers()).toBe(false);
  });

  it('un handler que devuelve true marca el evento como manejado', () => {
    const un = registerBackHandler(() => true);
    expect(tryBackHandlers()).toBe(true);
    un();
  });

  it('handlers que devuelven false no manejan el evento', () => {
    const un = registerBackHandler(() => false);
    expect(tryBackHandlers()).toBe(false);
    un();
  });

  it('al desregistrar, el handler deja de consultarse', () => {
    const fn = vi.fn(() => true);
    const un = registerBackHandler(fn);
    un();
    expect(tryBackHandlers()).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('el primer handler que devuelve true detiene la cadena', () => {
    const second = vi.fn(() => true);
    const un1 = registerBackHandler(() => true);
    const un2 = registerBackHandler(second);
    expect(tryBackHandlers()).toBe(true);
    expect(second).not.toHaveBeenCalled();
    un1(); un2();
  });

  it('un handler que lanza no bloquea a los demás', () => {
    const un1 = registerBackHandler(() => { throw new Error('x'); });
    const un2 = registerBackHandler(() => true);
    expect(tryBackHandlers()).toBe(true);
    un1(); un2();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `cd client && npx vitest run src/lib/backActions.test.js`
Expected: FAIL — no resuelve `./backActions.js`.

- [ ] **Step 3: Implementación mínima**

`client/src/lib/backActions.js`:

```js
// Registro mínimo de handlers para el botón/gesto atrás nativo (Android).
// Una pantalla registra un handler que devuelve true si consumió el evento;
// useNativeBack los consulta antes de aplicar su comportamiento por defecto.
const handlers = new Set();

export function registerBackHandler(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

export function tryBackHandlers() {
  for (const fn of handlers) {
    try { if (fn()) return true; } catch { /* un handler roto no debe bloquear el atrás */ }
  }
  return false;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `cd client && npx vitest run src/lib/backActions.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/backActions.js client/src/lib/backActions.test.js
git commit -m "feat(lib): add back-handler registry for native back button"
```

---

### Task 2: `useNativeBack` consulta el registro

**Files:**
- Modify: `client/src/lib/useNativeBack.js`
- Test: `client/src/lib/useNativeBack.test.js` (nuevo)

**Interfaces:**
- Consumes: `tryBackHandlers()` de Task 1.
- Produces: sin cambios de API; el listener `backButton` ahora corta si un handler devuelve `true`.

- [ ] **Step 1: Escribir el test que falla**

`client/src/lib/useNativeBack.test.js`:

```js
import { renderHook, waitFor } from '@testing-library/react';
import { useNativeBack } from './useNativeBack.js';
import { registerBackHandler } from './backActions.js';

const h = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  minimizeApp: vi.fn(),
  listeners: {},
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => h.navigateMock,
  useLocation: () => ({ pathname: '/read/42' }),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event, cb) => { h.listeners[event] = cb; return { remove: () => {} }; },
    minimizeApp: h.minimizeApp,
  },
}));

describe('useNativeBack', () => {
  beforeEach(() => {
    h.navigateMock.mockClear();
    h.minimizeApp.mockClear();
    delete h.listeners.backButton;
  });

  it('sin handlers registrados, en /read/ navega a la biblioteca', async () => {
    renderHook(() => useNativeBack());
    await waitFor(() => expect(h.listeners.backButton).toBeTypeOf('function'));
    h.listeners.backButton();
    expect(h.navigateMock).toHaveBeenCalledWith('/');
  });

  it('un handler que devuelve true corta el comportamiento por defecto', async () => {
    const unregister = registerBackHandler(() => true);
    renderHook(() => useNativeBack());
    await waitFor(() => expect(h.listeners.backButton).toBeTypeOf('function'));
    h.listeners.backButton();
    expect(h.navigateMock).not.toHaveBeenCalled();
    expect(h.minimizeApp).not.toHaveBeenCalled();
    unregister();
  });
});
```

Nota: los imports de `./useNativeBack.js` y `./backActions.js` van arriba; `vi.mock` se iza por encima de ellos y `vi.hoisted` evita el error de acceso antes de inicializar.

- [ ] **Step 2: Verificar que falla**

Run: `cd client && npx vitest run src/lib/useNativeBack.test.js`
Expected: el primer test PASA (comportamiento actual) y el segundo FALLA (`navigateMock` sí fue llamado) — confirma que el corte aún no existe.

- [ ] **Step 3: Implementación mínima**

En `client/src/lib/useNativeBack.js`, añadir el import y consultar el registro al inicio del listener:

```js
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { tryBackHandlers } from './backActions.js';

// Android back button: in /read/:id go back to library; on / minimize app
// instead of leaving the WebView in a broken state. Screens can override the
// default by registering a handler in backActions (e.g. undo an in-book jump).
export function useNativeBack() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handler;
    (async () => {
      handler = await CapacitorApp.addListener('backButton', () => {
        if (tryBackHandlers()) return;
        if (location.pathname.startsWith('/read/')) navigate('/');
        else CapacitorApp.minimizeApp();
      });
    })();
    return () => { handler?.remove(); };
  }, [location.pathname, navigate]);
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `cd client && npx vitest run src/lib`
Expected: PASS (backActions, useNativeBack y los tests preexistentes de lib).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/useNativeBack.js client/src/lib/useNativeBack.test.js
git commit -m "feat(lib): consult back-handler registry in useNativeBack"
```

---

### Task 3: `ReaderPage` — espejo de historiales y handler nativo

**Files:**
- Modify: `client/src/reader/ReaderPage.jsx`
- Modify: `docs/superpowers/specs/2026-07-19-reader-back-navigation-design.md` (añadir caso borde de lectura en voz alta)

**Interfaces:**
- Consumes: `registerBackHandler` de Task 1; `view.history` de foliate (`addEventListener('index-change')`, `canGoBack`, `back()`, `forward()`).
- Produces: estado `jumpDepth` (number) y `chipDismissed`/`setChipDismissed` (boolean) que la Task 4 usa para el chip y la flecha; refs `jumpDepthRef`, `historyNavRef`.

Sin test unitario: la lógica depende del custom element de foliate; la verificación es manual (Task 5) más `npm test`/`npm run build` para no romper lo existente.

- [ ] **Step 1: Imports y estado**

En `client/src/reader/ReaderPage.jsx`:

Línea 2, añadir `useLocation`:

```js
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
```

Línea 7 aprox., añadir tras los imports de lib existentes:

```js
import { registerBackHandler } from '../lib/backActions.js';
```

Tras `const navigate = useNavigate();` añadir:

```js
const location = useLocation();
```

Tras `const latestPosRef = useRef(null);` añadir:

```js
// Saltos de posición pendientes (enlace / índice / anotación). La profundidad
// vive en el state del router; estas refs la espejan para los listeners.
const jumpDepthRef = useRef(0);
const historyNavRef = useRef(false); // true mientras nosotros llamamos back()/forward()
const [jumpDepth, setJumpDepth] = useState(0);
const [chipDismissed, setChipDismissed] = useState(false);
```

- [ ] **Step 2: Listener `index-change` en el efecto principal**

Inmediatamente después del bloque `setTimeout(() => { savingEnabled = true; }, 500);` (la posición inicial ya se restauró: los push de la restauración no llegan a este listener), insertar:

```js
// Espeja los saltos del historial interno de foliate en el historial del
// navegador: cada push (enlace, índice, anotación) añade una entrada de la
// misma ruta con la profundidad en state. Todos los "atrás" convergen en
// navigate(-1); el efecto sobre location deshace el salto en foliate.
const onIndexChange = () => {
  if (!view.history.canGoBack) {
    jumpDepthRef.current = 0;
    setJumpDepth(0);
    return;
  }
  if (historyNavRef.current) return; // back()/forward() propio: ya sincronizado
  if (readingRef.current) return;    // goTo interno de la lectura en voz alta
  const depth = jumpDepthRef.current + 1;
  jumpDepthRef.current = depth;
  setJumpDepth(depth);
  setChipDismissed(false);
  navigate(window.location.pathname + window.location.search, { state: { jumpDepth: depth } });
};
view.history.addEventListener('index-change', onIndexChange);
cleanups.push(() => view.history.removeEventListener('index-change', onIndexChange));
```

- [ ] **Step 3: Efectos de sincronización**

Después del efecto online/offline (el que registra `window.addEventListener('online', …)`), añadir tres efectos:

```js
// Al entrar (o cambiar de libro) la pila de saltos empieza vacía; si la URL
// trae state de una sesión previa (recarga, retorno desde la biblioteca), se
// limpia para que el chip no aparezca sin salto real.
useEffect(() => {
  jumpDepthRef.current = 0;
  setJumpDepth(0);
  setChipDismissed(false);
  if ((location.state?.jumpDepth ?? 0) !== 0) {
    navigate(window.location.pathname + window.location.search, { replace: true, state: { jumpDepth: 0 } });
  }
}, [bookId]);

// Cambio de entrada del router en la misma ruta (atrás/adelante del navegador,
// navigate(-1) desde chip/flecha/gesto): la profundidad del state manda y se
// aplica sobre el historial de foliate. El flag evita que index-change vuelva
// a empujar entradas mientras deshacemos.
useEffect(() => {
  const view = viewRef.current;
  if (!view) return;
  const stateDepth = location.state?.jumpDepth ?? 0;
  const current = jumpDepthRef.current;
  if (stateDepth === current) return;
  jumpDepthRef.current = stateDepth;
  setJumpDepth(stateDepth);
  historyNavRef.current = true;
  try {
    if (stateDepth < current) { for (let i = stateDepth; i < current; i++) view.history.back(); }
    else { for (let i = current; i < stateDepth; i++) view.history.forward(); }
  } finally { historyNavRef.current = false; }
}, [location]);

// Botón/gesto atrás de Android: con salto pendiente lo deshace y consume el
// evento; si no, useNativeBack aplica su default (salir a la biblioteca).
useEffect(() => {
  if (!isNative) return;
  return registerBackHandler(() => {
    if (jumpDepthRef.current > 0) { navigate(-1); return true; }
    return false;
  });
}, [isNative, navigate]);
```

- [ ] **Step 4: Caso borde en el spec**

En `docs/superpowers/specs/2026-07-19-reader-back-navigation-design.md`, sección «Casos borde», añadir:

```markdown
- **Lectura en voz alta (nativo):** al preparar la lectura, `useReadAloud` hace un `goTo` interno para volver a la página inicial; ese push se ignora en `index-change` mientras `readingRef` está activo, así que no genera salto pendiente ni chip.
```

- [ ] **Step 5: Verificar que nada se rompe**

Run: `cd client && npm test && npm run build`
Expected: tests PASS, build OK.

- [ ] **Step 6: Commit**

```bash
git add client/src/reader/ReaderPage.jsx docs/superpowers/specs/2026-07-19-reader-back-navigation-design.md
git commit -m "feat(reader): mirror foliate jump history in browser history"
```

Nota: `ReaderPage.jsx` tiene un overlay de diagnóstico `selDbg` sin commitear; usar `git add -p` si hace falta y commitear solo los hunks de esta task.

- [ ] **Step 7: Prueba rápida en web**

Run: `cd client && npm run dev` y abrir un libro con notas al pie o índice.
Expected: clic en un enlace interno → el botón atrás del navegador regresa a la posición previa; adelante rehace el salto. (El chip y la flecha llegan en Task 4.)

---

### Task 4: Chip «Volver a la lectura» y flecha del encabezado

**Files:**
- Modify: `client/src/reader/ReaderPage.jsx`
- Modify: `client/src/reader/reader.module.css`

**Interfaces:**
- Consumes: `jumpDepth`, `chipDismissed`, `setChipDismissed` de Task 3; `navigate(-1)`.

- [ ] **Step 1: Flecha del encabezado con doble función**

En el JSX del header, reemplazar:

```jsx
<button className={styles.back} onClick={goBack} aria-label="Volver">
  <ArrowLeft size={18} strokeWidth={2.75} />
</button>
```

por:

```jsx
<button className={styles.back}
  onClick={jumpDepth > 0 ? () => navigate(-1) : goBack}
  aria-label={jumpDepth > 0 ? 'Volver a la lectura' : 'Volver'}
  title={jumpDepth > 0 ? 'Volver a la lectura' : 'Volver'}>
  <ArrowLeft size={18} strokeWidth={2.75} />
</button>
```

- [ ] **Step 2: Chip flotante**

Dentro de `<div className={styles.viewport} ref={containerRef}>`, después del bloque de botones `navBtn` (`{!isNative && (…)}`), añadir:

```jsx
{jumpDepth > 0 && !chipDismissed && (
  <div className={styles.jumpBack} role="status">
    <button className={styles.jumpBackBtn} onClick={() => navigate(-1)}>
      <ArrowLeft size={14} strokeWidth={2.5} />
      Volver a la lectura
    </button>
    <button className={styles.jumpBackClose} onClick={() => setChipDismissed(true)} aria-label="Descartar">
      <X size={14} strokeWidth={2} />
    </button>
  </div>
)}
```

(`ArrowLeft` y `X` ya están importados de lucide-react.)

- [ ] **Step 3: Estilos**

Al final de `client/src/reader/reader.module.css`, junto a los estilos `offHint` (misma paleta), añadir:

```css
.jumpBack {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  background: #102060;
  color: #fff;
  border-radius: 999px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .25);
  z-index: 30;
}
.jumpBackBtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  padding: 9px 4px 9px 14px;
  cursor: pointer;
}
.jumpBackClose {
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: none;
  color: inherit;
  padding: 9px 12px 9px 4px;
  cursor: pointer;
}
```

Verificar que `.viewport` tiene `position: relative` (los `navBtn` absolutos ya viven ahí; si no lo tiene, añadirlo).

- [ ] **Step 4: Verificar**

Run: `cd client && npm test && npm run build`
Expected: PASS / build OK.

- [ ] **Step 5: Commit**

```bash
git add client/src/reader/ReaderPage.jsx client/src/reader/reader.module.css
git commit -m "feat(reader): add back-to-reading chip and header arrow fallback"
```

---

### Task 5: Verificación manual

- [ ] **Web escritorio (`cd client && npm run dev`):**
  1. Enlace interno → volver con atrás del navegador, con el chip y con la flecha: cada uno restaura la posición previa.
  2. Dos saltos encadenados → atrás dos veces deshace en orden inverso.
  3. Tras volver, adelante del navegador rehace el salto.
  4. Salto desde el índice de capítulos y desde «Ir al pasaje» de una anotación → atrás regresa.
  5. X del chip → desaparece; un salto nuevo lo reaparece.
  6. Sin salto pendiente, la flecha sale a la biblioteca y guarda progreso (comportamiento actual intacto).
  7. Recargar (F5) tras un salto → sin chip, atrás del navegador sale del libro (state saneado).
- [ ] **Android (build nativo, cuando el usuario pueda probar):**
  8. Gesto atrás con salto pendiente → regresa; sin salto → sale a la biblioteca.
  9. Lectura en voz alta: al iniciarla no aparece el chip; volumen y gestos siguen bien tras un salto y su regreso.
- [ ] **Compartido:** libro compartido → enlace → atrás funciona igual.
