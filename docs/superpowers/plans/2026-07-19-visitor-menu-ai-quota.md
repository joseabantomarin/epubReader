# Menú de selección para visitantes + cupo anónimo de IA — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menú contextual visible sin sesión y en compartidos (Dicc/IA/Copiar/Compartir; anotar solo en libro propio), con IA anónima limitada a 10 consultas/día/IP y mensaje de empuje a autenticarse.

**Architecture:** El servidor pasa el endpoint de IA a `authOptional` y consulta un contador en memoria (`aiQuota.js`) para anónimos. El cliente quita el gate `!isShared` del menú, añade la prop `canAnnotate` a `SelectionMenu`, y el modal de IA muestra/bloquea con el mensaje de autenticación ante `ai_quota` o `unauthorized` sin sesión. Spec: `docs/superpowers/specs/2026-07-19-visitor-selection-menu-ai-quota-design.md`.

**Tech Stack:** Express (server, vitest en `server/tests/`), React 18 (client, vitest + @testing-library en `client/src/`).

## Global Constraints

- Texto exacto del mensaje: «Autentícate con Google para seguir usando la IA».
- Cupo anónimo: `ANON_AI_LIMIT = 10` por día por IP; cada turno del chat consume; se consume al recibir la petición.
- Sin dependencias nuevas. UI en español.
- Tests server: `cd server && npm test`. Tests client: `cd client && npm test`. Build web: `cd client && npm run build`.
- Commits convencionales terminados con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Cambio de backend: el restart del servicio lo hace Jose a mano (`sudo systemctl restart epubreader`); NUNCA matar el PID.

---

### Task 1: `aiQuota.js` — contador anónimo (TDD)

**Files:**
- Create: `server/src/aiQuota.js`
- Test: `server/tests/ai_quota.test.js`

**Interfaces:**
- Produces: `ANON_AI_LIMIT: number` y `consumeAnonQuota(ip: string, now?: Date): boolean` (true = permitido e incrementa; false = cupo agotado). Los consume la Task 2.

- [ ] **Step 1: Test que falla** — `server/tests/ai_quota.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { consumeAnonQuota, ANON_AI_LIMIT } from '../src/aiQuota.js';

const d = (s) => new Date(s);

// El módulo tiene estado compartido; los tests se apoyan en el orden del
// archivo y en IPs/días distintos para no pisarse.
describe('aiQuota', () => {
  it('permite el límite diario y rechaza la consulta siguiente', () => {
    const now = d('2026-07-19T10:00:00Z');
    for (let i = 0; i < ANON_AI_LIMIT; i++) {
      expect(consumeAnonQuota('1.1.1.1', now)).toBe(true);
    }
    expect(consumeAnonQuota('1.1.1.1', now)).toBe(false);
  });

  it('cada IP tiene su propio cupo', () => {
    const now = d('2026-07-19T11:00:00Z');
    expect(consumeAnonQuota('2.2.2.2', now)).toBe(true);
  });

  it('el cupo se renueva al cambiar el día', () => {
    expect(consumeAnonQuota('1.1.1.1', d('2026-07-20T00:10:00Z'))).toBe(true);
  });
});
```

- [ ] **Step 2: Verificar fallo** — Run: `cd server && npx vitest run tests/ai_quota.test.js` — Expected: FAIL (no resuelve `../src/aiQuota.js`).

- [ ] **Step 3: Implementación** — `server/src/aiQuota.js`:

```js
// Cupo diario de consultas de IA para visitantes anónimos, en memoria por IP.
// Se reinicia con el proceso: es un empujón a autenticarse, no facturación.
export const ANON_AI_LIMIT = 10;

let day = null;
const counts = new Map();

export function consumeAnonQuota(ip, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (today !== day) { day = today; counts.clear(); }
  const used = counts.get(ip) ?? 0;
  if (used >= ANON_AI_LIMIT) return false;
  counts.set(ip, used + 1);
  return true;
}
```

- [ ] **Step 4: Verificar éxito** — Run: `cd server && npx vitest run tests/ai_quota.test.js` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/aiQuota.js server/tests/ai_quota.test.js
git commit -m "feat(ai): add in-memory daily quota for anonymous AI use"
```

---

### Task 2: Endpoint de IA con auth opcional y cupo

**Files:**
- Modify: `server/src/routes/ai.js`

**Interfaces:**
- Consumes: `authOptional` (existe en `server/src/middleware/authOptional.js`, deja `req.user` en `null` si no hay token válido) y `consumeAnonQuota` de Task 1.
- Produces: respuesta `429 { error: 'ai_quota' }` cuando un anónimo agota el cupo; el cliente (Task 4) la detecta por `e.message === 'ai_quota'`.

- [ ] **Step 1: Editar la ruta** — en `server/src/routes/ai.js`, cambiar el import y el middleware:

```js
import { authOptional } from '../middleware/authOptional.js';
import { consumeAnonQuota } from '../aiQuota.js';
```

(eliminar el import de `authRequired`), `r.use(authRequired)` → `r.use(authOptional)`, y tras la validación del cuerpo:

```js
    if (!convo || !convo.length) return res.status(400).json({ error: 'missing_text' });
    // Anónimos: cupo diario por IP (req.ip es real: trust proxy configurado).
    if (!req.user && !consumeAnonQuota(req.ip)) {
      return res.status(429).json({ error: 'ai_quota' });
    }
```

- [ ] **Step 2: Verificar** — Run: `cd server && npm test` — Expected: PASS (suite completa, incluye ai_quota).

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/ai.js
git commit -m "feat(ai): allow anonymous AI queries behind daily IP quota"
```

---

### Task 3: `SelectionMenu` con `canAnnotate` (TDD)

**Files:**
- Modify: `client/src/reader/SelectionMenu.jsx`
- Test: `client/src/reader/SelectionMenu.test.jsx`

**Interfaces:**
- Produces: prop `canAnnotate?: boolean = true`; en `false` oculta Subrayar/Nota/Eliminar. La consume Task 4.

- [ ] **Step 1: Test que falla** — `client/src/reader/SelectionMenu.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import SelectionMenu from './SelectionMenu.jsx';

const pos = { x: 100, y: 100 };

describe('SelectionMenu', () => {
  it('sin canAnnotate solo muestra Dicc/IA/Copiar/Compartir', () => {
    render(<SelectionMenu pos={pos} canAnnotate={false} showAI />);
    expect(screen.getByText('Dicc.')).toBeTruthy();
    expect(screen.getByText('IA')).toBeTruthy();
    expect(screen.getByText('Copiar')).toBeTruthy();
    expect(screen.getByText('Compartir')).toBeTruthy();
    expect(screen.queryByText('Subrayar')).toBeNull();
    expect(screen.queryByText('Nota')).toBeNull();
    expect(screen.queryByText('Eliminar')).toBeNull();
  });

  it('con canAnnotate (default) muestra Subrayar y Nota', () => {
    render(<SelectionMenu pos={pos} showAI={false} />);
    expect(screen.getByText('Subrayar')).toBeTruthy();
    expect(screen.getByText('Nota')).toBeTruthy();
    expect(screen.queryByText('IA')).toBeNull();
  });

  it('con existingId muestra Eliminar y no Subrayar', () => {
    render(<SelectionMenu pos={pos} existingId={7} />);
    expect(screen.getByText('Eliminar')).toBeTruthy();
    expect(screen.queryByText('Subrayar')).toBeNull();
  });

  it('sin pos no renderiza nada', () => {
    const { container } = render(<SelectionMenu pos={null} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Verificar fallo** — Run: `cd client && npx vitest run src/reader/SelectionMenu.test.jsx` — Expected: FAIL en el primer test (Subrayar/Nota visibles pese a `canAnnotate={false}`); el resto PASS.

- [ ] **Step 3: Implementación** — en `client/src/reader/SelectionMenu.jsx`, firma y botones:

```jsx
export default function SelectionMenu({
  pos, existingId, canAnnotate = true,
  onDictionary, onHighlight, onNote, onCopy, onShare, onDelete, onExplainAI, showAI,
}) {
```

```jsx
      <button className={styles.menuBtn} onClick={onDictionary}>Dicc.</button>
      {showAI && <button className={styles.menuBtn} onClick={onExplainAI}>IA</button>}
      {canAnnotate && !existingId && <button className={styles.menuBtn} onClick={onHighlight}>Subrayar</button>}
      {canAnnotate && <button className={styles.menuBtn} onClick={onNote}>Nota</button>}
      <button className={styles.menuBtn} onClick={onCopy}>Copiar</button>
      <button className={styles.menuBtn} onClick={onShare}>Compartir</button>
      {canAnnotate && existingId && <button className={styles.menuBtn} onClick={onDelete}>Eliminar</button>}
```

(De paso desaparece el ternario muerto `{existingId ? 'Nota' : 'Nota'}`.)

- [ ] **Step 4: Verificar éxito** — Run: `cd client && npx vitest run src/reader/SelectionMenu.test.jsx` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/reader/SelectionMenu.jsx client/src/reader/SelectionMenu.test.jsx
git commit -m "feat(reader): add canAnnotate prop to SelectionMenu"
```

---

### Task 4: ReaderPage sin gate + modal de IA con mensaje y bloqueo

**Files:**
- Modify: `client/src/reader/ReaderPage.jsx` (bloque del `<SelectionMenu>`)
- Modify: `client/src/reader/AIExplainModal.jsx`

**Interfaces:**
- Consumes: `canAnnotate` de Task 3; error `ai_quota` de Task 2; `getToken` de `client/src/lib/api.js` (el `call()` de api.js lanza `Error('unauthorized')` en 401 y `Error('ai_quota')` con `.status=429` vía `err.error`).

- [ ] **Step 1: ReaderPage** — reemplazar el bloque actual:

```jsx
      {!isShared && (
        <SelectionMenu
```

por `<SelectionMenu` sin el gate (y quitar el `)}` de cierre correspondiente), añadiendo la prop tras `existingId`:

```jsx
      <SelectionMenu
        pos={reading ? null : menuPos}
        existingId={selection?.existingId}
        canAnnotate={!isShared}
```

El resto de props queda igual (incluido `showAI={online}` y el `onExplainAI` con `clearSelection()`).

- [ ] **Step 2: AIExplainModal** — en `client/src/reader/AIExplainModal.jsx`:

Import: `import { api, getToken } from '../lib/api.js';`

Constante bajo los imports:

```js
const AUTH_MSG = 'Autentícate con Google para seguir usando la IA';
```

Estado nuevo junto a `error`: `const [blocked, setBlocked] = useState(false);`

En el efecto de apertura, resetear también `blocked` en ambas ramas:

```js
    if (!text) { setMessages([]); setInput(''); setError(null); setLoading(false); setBlocked(false); return; }
    setBlocked(false);
```

Catch de `runTurn`:

```js
    } catch (e) {
      if (e?.message === 'ai_quota' || (e?.message === 'unauthorized' && !getToken())) {
        setError(AUTH_MSG);
        setBlocked(true);
      } else {
        setError('No se pudo consultar la IA.');
      }
    } finally {
```

Aviso permanente para anónimos, dentro de `chatBody` tras el bloque de `error`:

```jsx
          {!getToken() && !blocked && visible.some((m) => m.role === 'assistant') && (
            <p className={styles.dictEmpty}>{AUTH_MSG}</p>
          )}
```

Entrada deshabilitada al bloquear:

```jsx
          <textarea ... disabled={blocked} ... />
          <button className={styles.btnPrimary} onClick={onSend} disabled={loading || blocked || !input.trim()}>
```

(en el textarea solo se añade el atributo `disabled={blocked}`, el resto de props queda igual).

- [ ] **Step 3: Verificar** — Run: `cd client && npm test && npm run build` — Expected: tests PASS, build OK.

- [ ] **Step 4: Commit**

```bash
git add client/src/reader/ReaderPage.jsx client/src/reader/AIExplainModal.jsx
git commit -m "feat(reader): selection menu for visitors and auth nudge in AI modal"
```

---

### Task 5: Deploy y verificación

- [ ] **Step 1: Push y build en el server**

```bash
git push
ssh administrator@147.93.176.249 'cd ~/epubReader && git pull && cd client && npm run build'
```

- [ ] **Step 2: Pedir a Jose el restart** (cambio de backend; sin esto el endpoint anónimo sigue en 401, que el modal convierte en el mensaje de autenticación — sin ventana rota):

```bash
sudo systemctl restart epubreader
```

- [ ] **Step 3: Verificar tras el restart** — `curl -s https://mislibros.openlinks.app/api/health` → 200; y una consulta anónima:

```bash
curl -s -X POST https://mislibros.openlinks.app/api/ai/explain -H 'Content-Type: application/json' -d '{"text":"prueba"}'
```

Expected: JSON con `explanation` (no `{"error":"missing_token"}`).

- [ ] **Step 4: Checklist manual (usuario)** — móvil sin sesión: menú con Dicc/IA/Copiar/Compartir y sin Subrayar/Nota; respuesta de IA con el aviso debajo; 11.ª consulta del día → mensaje y envío bloqueado; con sesión: menú completo, sin aviso ni límite.
