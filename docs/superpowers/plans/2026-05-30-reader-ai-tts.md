# Reader AI-Explain + Text-to-Speech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two reader features — "Explicar con IA" (Groq, on selected text, online-only) and "Leer en voz alta" (Web Speech API, time-based, from current page, advancing the page; always visible).

**Architecture:** Feature A adds a server proxy route `/api/ai/explain` that calls Groq (key in server `.env`), surfaced by a button in `SelectionMenu` and a result modal. Feature B is client-only: a speaker button in the reader header drives `window.speechSynthesis`, reading the current page's text, advancing `view.next()` after each page until a time budget elapses.

**Tech Stack:** Express + better-sqlite3 + vitest (server), React + Vite + foliate-js + Web Speech API (client). Groq Chat Completions via native `fetch` (Node 18+).

---

## File Structure

- `server/src/config.js` — add `groqApiKey`, `groqModel` (modify).
- `server/src/routes/ai.js` — new router `createAIRouter`, `POST /explain` (create).
- `server/src/app.js` — mount `/api/ai` (modify).
- `server/tests/routes.ai.test.js` — tests for the AI route (create).
- `client/src/lib/api.js` — add `explainWithAI` (modify).
- `client/src/reader/AIExplainModal.jsx` — new modal (create).
- `client/src/reader/SelectionMenu.jsx` — add "IA" button (modify).
- `client/src/reader/useReadAloud.js` — TTS reading hook (create).
- `client/src/reader/ReaderPage.jsx` — wire AI modal, online state, speaker button, read-aloud (modify).
- `client/src/reader/reader.module.css` — speaker/stop button + minutes-prompt styles (modify).
- `OPS.md` — document `GROQ_API_KEY` / `GROQ_MODEL` (modify).

---

## Task 1: Server config — Groq settings

**Files:**
- Modify: `server/src/config.js`

- [ ] **Step 1: Add Groq config fields**

In `server/src/config.js`, inside the `config` object (after `adminEmails`), add:

```js
  // Groq (AI explain). Optional — if no key, the AI endpoint is disabled.
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
```

- [ ] **Step 2: Commit**

```bash
git add server/src/config.js
git commit -m "feat(config): Groq API key + model settings"
```

---

## Task 2: Server AI route `/api/ai/explain` (TDD)

**Files:**
- Create: `server/src/routes/ai.js`
- Modify: `server/src/app.js`
- Test: `server/tests/routes.ai.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/tests/routes.ai.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createAIRouter } from '../src/routes/ai.js';
import { config } from '../src/config.js';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/ai', createAIRouter(db));
  return a;
}

describe('POST /api/ai/explain', () => {
  let db, user, a;
  beforeEach(() => {
    db = makeDb();
    user = insertUser(db, { email: 'u@x.com' });
    a = app(db);
    config.groqApiKey = '';
  });
  afterEach(() => { config.groqApiKey = ''; vi.restoreAllMocks(); });

  it('401 without auth', async () => {
    config.groqApiKey = 'k';
    const res = await request(a).post('/api/ai/explain').send({ text: 'hola' });
    expect(res.status).toBe(401);
  });

  it('503 when no API key is configured', async () => {
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: 'hola' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'ai_disabled' });
  });

  it('400 when text is missing/empty', async () => {
    config.groqApiKey = 'k';
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns the explanation from Groq', async () => {
    config.groqApiKey = 'k';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Explicación simple.' } }] }),
    });
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: 'un pasaje' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ explanation: 'Explicación simple.' });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('502 when Groq fails', async () => {
    config.groqApiKey = 'k';
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: 'x' });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'ai_failed' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run tests/routes.ai.test.js`
Expected: FAIL — cannot import `createAIRouter` (module missing).

- [ ] **Step 3: Implement the AI router**

Create `server/src/routes/ai.js`:

```js
import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';
import { config } from '../config.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_CHARS = 2000;
const SYSTEM_PROMPT =
  'Eres un asistente que explica pasajes de libros en español, de forma clara, ' +
  'breve y sencilla. No inventes contexto que no esté en el texto.';

export function createAIRouter() {
  const r = Router();
  r.use(authRequired);

  r.post('/explain', async (req, res) => {
    if (!config.groqApiKey) return res.status(503).json({ error: 'ai_disabled' });
    const raw = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!raw) return res.status(400).json({ error: 'missing_text' });
    const text = raw.slice(0, MAX_CHARS);
    try {
      const r2 = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.groqApiKey}`,
        },
        body: JSON.stringify({
          model: config.groqModel,
          temperature: 0.3,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Explica este pasaje:\n\n${text}` },
          ],
        }),
      });
      if (!r2.ok) return res.status(502).json({ error: 'ai_failed' });
      const data = await r2.json();
      const explanation = data?.choices?.[0]?.message?.content?.trim();
      if (!explanation) return res.status(502).json({ error: 'ai_failed' });
      res.json({ explanation });
    } catch {
      res.status(502).json({ error: 'ai_failed' });
    }
  });

  return r;
}
```

- [ ] **Step 4: Mount the router in app.js**

In `server/src/app.js`, add the import near the other route imports:

```js
import { createAIRouter } from './routes/ai.js';
```

And mount it next to the other `app.use('/api/...')` lines (after `/api/shared`):

```js
  if (!isTest) {
    app.use('/api/ai', rateLimit({ windowMs: 60_000, max: 20 }));
  }
  app.use('/api/ai', createAIRouter(db));
```

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: PASS — all prior tests plus the 5 new AI tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/ai.js server/src/app.js server/tests/routes.ai.test.js
git commit -m "feat(ai): /api/ai/explain Groq proxy (auth + rate-limited)"
```

---

## Task 3: Client — AI explain button + modal

**Files:**
- Modify: `client/src/lib/api.js`
- Create: `client/src/reader/AIExplainModal.jsx`
- Modify: `client/src/reader/SelectionMenu.jsx`
- Modify: `client/src/reader/ReaderPage.jsx`

- [ ] **Step 1: Add the API helper**

In `client/src/lib/api.js`, inside the `api` object (after the rating helpers), add:

```js
  explainWithAI: (text) => call('/api/ai/explain', { method: 'POST', body: { text } }),
```

- [ ] **Step 2: Create the AI modal**

Create `client/src/reader/AIExplainModal.jsx` (reuses the WiktionaryModal styles):

```jsx
import { useEffect, useState } from 'react';
import styles from './annotations.module.css';
import { api } from '../lib/api.js';

// Shows a Groq explanation of the given text. `text` non-null = open.
export default function AIExplainModal({ text, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, explanation: '' });

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    setState({ loading: true, error: null, explanation: '' });
    (async () => {
      try {
        const { explanation } = await api.explainWithAI(text);
        if (!cancelled) setState({ loading: false, error: null, explanation });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: 'No se pudo consultar la IA.', explanation: '' });
      }
    })();
    return () => { cancelled = true; };
  }, [text]);

  if (!text) return null;
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <p className={styles.dictWord}>Explicación (IA)</p>
          <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className={styles.modalBody}>
          {state.loading && <p>Consultando…</p>}
          {!state.loading && state.error && <p className={styles.dictEmpty}>{state.error}</p>}
          {!state.loading && !state.error && (
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{state.explanation}</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the "IA" button to SelectionMenu**

In `client/src/reader/SelectionMenu.jsx`, add `onExplainAI` and `showAI` to the props, and render the button after "Diccionario" only when `showAI` is true:

```jsx
export default function SelectionMenu({
  pos, existingId, onDictionary, onExplainAI, showAI,
  onHighlight, onNote, onCopy, onShare, onDelete,
}) {
```

Then in the returned menu, right after the Diccionario button:

```jsx
      <button className={styles.menuBtn} onClick={onDictionary}>Diccionario</button>
      {showAI && <button className={styles.menuBtn} onClick={onExplainAI}>IA</button>}
```

- [ ] **Step 4: Wire it in ReaderPage — imports and state**

In `client/src/reader/ReaderPage.jsx`, add the import next to the other reader imports:

```jsx
import AIExplainModal from './AIExplainModal.jsx';
```

Add state near the other `useState` calls (e.g. next to `dictTerm`):

```jsx
  const [aiText, setAiText] = useState(null);
  const [online, setOnline] = useState(() => navigator.onLine);
```

Add an effect (near the other effects) to track connectivity:

```jsx
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
```

- [ ] **Step 5: Wire the SelectionMenu props and render the modal**

In `ReaderPage.jsx`, update the `<SelectionMenu .../>` usage to pass the new props:

```jsx
        <SelectionMenu
          pos={menuPos}
          existingId={selection?.existingId}
          onDictionary={onDictionary}
          showAI={online}
          onExplainAI={() => { if (selection?.text) setAiText(selection.text); }}
          onHighlight={onHighlight}
          onNote={onNote}
          onCopy={onCopy}
          onShare={onShare}
          onDelete={onDelete}
        />
```

Render the modal next to `WiktionaryModal`:

```jsx
      <AIExplainModal text={aiText} onClose={() => { setAiText(null); clearSelection(); }} />
```

- [ ] **Step 6: Build to verify it compiles**

Run: `cd client && npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/api.js client/src/reader/AIExplainModal.jsx client/src/reader/SelectionMenu.jsx client/src/reader/ReaderPage.jsx
git commit -m "feat(reader): Explicar con IA button + modal (online only)"
```

---

## Task 4: Client — Read aloud (time-based, page-advancing)

**Files:**
- Create: `client/src/reader/useReadAloud.js`
- Modify: `client/src/reader/ReaderPage.jsx`
- Modify: `client/src/reader/reader.module.css`

- [ ] **Step 1: Create the read-aloud hook**

Create `client/src/reader/useReadAloud.js`. It reads the current page's text, speaks it, advances `view.next()` after each page, and stops when the time budget elapses. `getView` returns the foliate view (`viewRef.current`); `getPageText` returns the visible page's text.

```js
import { useCallback, useEffect, useRef, useState } from 'react';

// Drives window.speechSynthesis to read from the current page for `minutes`,
// advancing the foliate view one page after each utterance ends.
export function useReadAloud({ getView, getPageText, lang }) {
  const [reading, setReading] = useState(false);
  const stopRef = useRef(false);

  const stop = useCallback(() => {
    stopRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {}
    setReading(false);
  }, []);

  const speak = useCallback((text) => new Promise((resolve) => {
    if (!text || !text.trim()) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    const voice = window.speechSynthesis.getVoices()
      .find(v => lang && v.lang?.toLowerCase().startsWith(String(lang).toLowerCase().split('-')[0]));
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  }), [lang]);

  const start = useCallback(async (minutes) => {
    const view = getView();
    if (!view) return;
    stopRef.current = false;
    setReading(true);
    const deadline = performance.now() + minutes * 60_000;
    try {
      while (!stopRef.current && performance.now() < deadline) {
        const text = getPageText();
        await speak(text);
        if (stopRef.current || performance.now() >= deadline) break;
        const before = view.renderer?.start;
        await view.next();
        await new Promise(r => setTimeout(r, 250)); // let relocate settle
        // Stop if we couldn't advance (end of book).
        if (view.renderer?.start === before) break;
      }
    } finally {
      try { window.speechSynthesis.cancel(); } catch {}
      setReading(false);
    }
  }, [getView, getPageText, speak]);

  useEffect(() => () => { stopRef.current = true; try { window.speechSynthesis.cancel(); } catch {} }, []);

  return { reading, start, stop };
}
```

- [ ] **Step 2: Add a page-text extractor in ReaderPage**

In `client/src/reader/ReaderPage.jsx`, add a helper that returns the text of the current page. Use the most-recently loaded document from `docsRef` (already maintained by the `load` handler). Place it near the other helpers:

```jsx
  const getPageText = () => {
    // Best-effort: text of the current section's document. The page advances
    // per utterance, so successive calls cover successive pages/sections.
    const entries = [...docsRef.current.values()];
    const doc = entries[entries.length - 1]?.doc;
    return doc?.body?.innerText?.trim() || '';
  };
```

> Note: per the spec's documented fallback, this reads the current section's text rather than a pixel-perfect single page. The view still advances one page per utterance, keeping the displayed page following the audio.

- [ ] **Step 3: Wire the hook and the minutes prompt**

In `ReaderPage.jsx`, import and use the hook (near other imports/hooks):

```jsx
import { useReadAloud } from './useReadAloud.js';
```

```jsx
  const { reading, start: startReadAloud, stop: stopReadAloud } =
    useReadAloud({ getView: () => viewRef.current, getPageText, lang: bookLang });

  const onSpeakerClick = () => {
    if (reading) { stopReadAloud(); return; }
    const ans = window.prompt('¿Cuántos minutos leer?', '15');
    if (ans === null) return;
    const minutes = Math.max(1, Math.min(180, Number(ans) || 15));
    startReadAloud(minutes);
  };
```

- [ ] **Step 4: Add the speaker button to the header**

In `ReaderPage.jsx`, in the `<header>`, after the TOC button block (the `☰` button) and before the annotations `★` button, add (always visible):

```jsx
        <button className={`${styles.back} ${reading ? styles.backActive : ''}`}
          onClick={onSpeakerClick}
          aria-label={reading ? 'Detener lectura' : 'Leer en voz alta'}
          title={reading ? 'Detener lectura' : 'Leer en voz alta'}>
          {reading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>
            </svg>
          )}
        </button>
```

- [ ] **Step 5: Build to verify it compiles**

Run: `cd client && npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 6: Manual verification**

Run the client (`npm run dev`), open a book, and confirm:
- The speaker icon appears in the header (online AND offline).
- Clicking it prompts for minutes (default 15); confirming starts speech from the current page.
- The page advances as it reads; the icon turns into a stop (■) and stops on click and on leaving the reader.

- [ ] **Step 7: Commit**

```bash
git add client/src/reader/useReadAloud.js client/src/reader/ReaderPage.jsx client/src/reader/reader.module.css
git commit -m "feat(reader): read aloud (Web Speech), time-based, advances pages"
```

---

## Task 5: Document the Groq env var

**Files:**
- Modify: `OPS.md`

- [ ] **Step 1: Add an AI section to OPS.md**

Under the "Admin / censura de libros" section (or near the env notes), add:

```markdown
## IA (Explicar con IA)

La función "Explicar con IA" usa Groq. Requiere en el `.env` del servidor:

```
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.1-8b-instant   # opcional
```

Sin `GROQ_API_KEY`, el endpoint responde 503 y el botón "IA" no aparece. Tras
añadir/cambiar la clave hay que reiniciar el backend (`sudo systemctl restart
epubreader.service`).
```

- [ ] **Step 2: Commit**

```bash
git add OPS.md
git commit -m "docs(ops): document GROQ_API_KEY for AI explain"
```

---

## Deployment notes (after all tasks)

- Backend changed (Task 1, 2) → after deploy, set `GROQ_API_KEY` in the server `.env`
  and **restart the backend** (`sudo systemctl restart epubreader.service`).
- Standard web deploy (`git pull` + `npm run build`) + APK rebuild per OPS.md.

## Self-review notes

- Spec coverage: A (button+modal+proxy+key handling+online gating) → Tasks 1–3; B
  (speaker always-visible, minutes prompt default 15, page advance, stop) → Task 4;
  OPS doc → Task 5. Tests for the AI route → Task 2.
- The TTS page-text extraction uses the documented fallback (section text + per-page
  advance), matching the spec's "precisión página-a-página no es requisito duro".
- Names checked: `explainWithAI`, `createAIRouter`, `AIExplainModal`, `useReadAloud`,
  `getPageText`, `onSpeakerClick` used consistently across tasks.
