# Page-Turn Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable page-turn animation (slide-with-shadow default, or fade) to the reader, persisted in localStorage, without modifying vendored foliate-js.

**Architecture:** A new `pageTransition` reader setting drives behavior at book open. `slide` enables foliate's native `animated` column scroll plus CSS edge shadows; `fade` leaves scrolling instant and runs an opacity fade-in on the `foliate-view` element inside the `relocate` handler. All navigation paths (buttons, keyboard, volume, swipe) funnel through `relocate`, so coverage is uniform.

**Tech Stack:** React (Vite), foliate-js (vendored), CSS Modules, Vitest.

---

### Task 1: Add `pageTransition` setting + test

**Files:**
- Modify: `client/src/lib/readerSettings.js:3-11`
- Test: `client/src/lib/readerSettings.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/readerSettings.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS, loadSettings, saveSettings } from './readerSettings.js';

describe('readerSettings pageTransition', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults pageTransition to slide', () => {
    expect(DEFAULTS.pageTransition).toBe('slide');
    expect(loadSettings().pageTransition).toBe('slide');
  });

  it('persists and reloads pageTransition', () => {
    saveSettings({ ...DEFAULTS, pageTransition: 'fade' });
    expect(loadSettings().pageTransition).toBe('fade');
  });

  it('fills pageTransition default when missing from stored JSON', () => {
    localStorage.setItem('epubreader.readerSettings', JSON.stringify({ theme: 'dark' }));
    const s = loadSettings();
    expect(s.theme).toBe('dark');
    expect(s.pageTransition).toBe('slide');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/lib/readerSettings.test.js`
Expected: FAIL — `DEFAULTS.pageTransition` is `undefined`.

- [ ] **Step 3: Add the default**

In `client/src/lib/readerSettings.js`, add the line inside `DEFAULTS` (after `viewMode`):

```js
export const DEFAULTS = {
  fontSize: 100,         // percentage, 60–200
  fontFamily: 'system',  // 'system' | 'serif' | 'sans-serif' | 'monospace'
  theme: 'auto',         // 'auto' | 'light' | 'sepia' | 'dark'
  lineHeight: 1.3,       // 1.0–2.2
  hyphenation: true,     // split words at line end (needs lang attr)
  handedness: 'right',   // 'right' | 'left' — which side advances pages
  viewMode: 'grid',      // 'grid' | 'list' — library layout on the main screen
  pageTransition: 'slide', // 'slide' (deslizar con sombra) | 'fade' (desvanecido)
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/lib/readerSettings.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/readerSettings.js client/src/lib/readerSettings.test.js
git commit -m "feat(reader): add pageTransition setting (slide default)"
```

---

### Task 2: Settings UI — transition chooser

**Files:**
- Modify: `client/src/library/SettingsModal.jsx` (add a section, mirroring "Mano dominante" at lines ~108-118)

- [ ] **Step 1: Add the section**

In `client/src/library/SettingsModal.jsx`, locate the "Mano dominante" block (chips with `s.handedness`). Immediately after that `</div>`-closed section block, add a new section. Use the exact same class names already in the file (`styles.section`, `styles.label`, `styles.chipRow`/`styles.chips` — match whatever wraps the handedness chips) and the `update()` helper:

```jsx
<div className={styles.section}>
  <label className={styles.label}>Animación al pasar página</label>
  <div className={styles.chips}>
    <button
      className={`${styles.chip} ${s.pageTransition === 'slide' ? styles.chipActive : ''}`}
      onClick={() => update({ pageTransition: 'slide' })}>Deslizar</button>
    <button
      className={`${styles.chip} ${s.pageTransition === 'fade' ? styles.chipActive : ''}`}
      onClick={() => update({ pageTransition: 'fade' })}>Desvanecido</button>
  </div>
</div>
```

> Note: match the wrapper class used by the handedness chips. Open the file and copy the exact wrapper (it is `styles.chips` if handedness uses `styles.chips`, or `styles.chipRow` otherwise). Do not invent a new class.

- [ ] **Step 2: Verify it renders**

Run: `cd client && npm run dev`, open the library, open Ajustes. Confirm "Animación al pasar página" shows two chips with **Deslizar** active by default. Click **Desvanecido**, reopen the modal — it stays selected (persisted).

- [ ] **Step 3: Commit**

```bash
git add client/src/library/SettingsModal.jsx
git commit -m "feat(reader): settings UI for page-turn animation"
```

---

### Task 3: Apply transition in the reader

**Files:**
- Modify: `client/src/reader/ReaderPage.jsx` (init in `start()` after `view.open`; `relocate` handler)

- [ ] **Step 1: Read the setting and tag the viewport**

In `ReaderPage.jsx`, inside `start()`, the settings are already loaded at the line `const settings = loadSettings();` (~line 232). Right after `applyColumnCount(); window.addEventListener('resize', applyColumnCount);` (i.e. after the renderer exists and `view.open` has run), add:

```js
// Page-turn transition mode (read once at open, like the other settings).
const pageTransition = settings.pageTransition || 'slide';
if (containerRef.current) containerRef.current.dataset.transition = pageTransition;
if (pageTransition === 'slide') {
  // Native foliate column-scroll animation, uniform across buttons/keys/swipe.
  try { view.renderer?.setAttribute('animated', ''); } catch {}
} else {
  // Fade: keep scrolling instant; fade the view in on each relocate.
  view.style.transition = 'opacity 180ms ease';
}
```

Note: `const settings = loadSettings();` already exists below this point in the current code (~line 232, inside the CSS block). Move the `const settings = loadSettings();` line up so it is declared before this new block, OR place this new block right after the existing `const settings = loadSettings();`. Ensure `settings` is declared exactly once. The cleanest edit: place the new block immediately after the existing `const settings = loadSettings();` line.

- [ ] **Step 2: Add a fade-ready flag**

Find the existing grace-period flag near `let savingEnabled = false;` (~line 292). Right after it, add:

```js
let fadeReady = false;
setTimeout(() => { fadeReady = true; }, 500);
```

- [ ] **Step 3: Trigger the fade inside the relocate handler**

In the `view.addEventListener('relocate', (e) => { ... })` handler (~line 312), at the very top of the callback body add:

```js
if (pageTransition === 'fade' && fadeReady) {
  view.style.opacity = '0';
  requestAnimationFrame(() => { view.style.opacity = '1'; });
}
```

(`pageTransition` is in scope via the closure from Step 1.)

- [ ] **Step 4: Verify slide**

Run: `cd client && npm run dev`. With **Deslizar** selected (default), open a book. Turning pages (side buttons, ArrowLeft/ArrowRight, swipe on touch) shows an animated horizontal slide instead of an instant jump.

- [ ] **Step 5: Verify fade**

In Ajustes choose **Desvanecido**, reopen the book. Turning pages now fades the content (no slide). Opening the book / restoring position does NOT flash a fade (guarded by `fadeReady`).

- [ ] **Step 6: Commit**

```bash
git add client/src/reader/ReaderPage.jsx
git commit -m "feat(reader): apply slide/fade page-turn transition"
```

---

### Task 4: Slide edge shadow (CSS)

**Files:**
- Modify: `client/src/reader/reader.module.css:56-61` (the `.viewport` rule)

- [ ] **Step 1: Add the edge-shadow pseudo-elements**

In `client/src/reader/reader.module.css`, after the existing `.viewport { ... }` and `.viewport > div { height: 100%; }` rules (lines 56-61), add:

```css
/* Slide mode: soft inner edge shadows so sliding content reads as paper
   passing under the book's edges. Only painted in slide mode. */
.viewport[data-transition="slide"]::before,
.viewport[data-transition="slide"]::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 18px;
  z-index: 2;
  pointer-events: none;
}
.viewport[data-transition="slide"]::before {
  left: 0;
  background: linear-gradient(to right, rgba(0,0,0,.16), rgba(0,0,0,0));
}
.viewport[data-transition="slide"]::after {
  right: 0;
  background: linear-gradient(to left, rgba(0,0,0,.16), rgba(0,0,0,0));
}
```

- [ ] **Step 2: Verify**

Run: `cd client && npm run dev`. In slide mode, the left/right inner edges of the reading area show a subtle shadow; content slides beneath them. In fade mode (`data-transition="fade"`) no edge shadow appears.

- [ ] **Step 3: Confirm the nav buttons stay clickable**

The `.navBtn` elements use `z-index`/positioning already; the pseudo-elements are `pointer-events: none`, so side-tap navigation still works. Click the left/right nav zones to confirm.

- [ ] **Step 4: Commit**

```bash
git add client/src/reader/reader.module.css
git commit -m "feat(reader): edge shadow for slide page-turn"
```

---

### Task 5: Full verification + build

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `cd client && npm test`
Expected: PASS, including `readerSettings.test.js` and existing `format.test.js`.

- [ ] **Step 2: Production build sanity**

Run: `cd client && npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Cross-check acceptance criteria**

Manually confirm against the spec:
1. Ajustes shows "Animación al pasar página"; **Deslizar** default.
2. Selection persists across reload (localStorage).
3. Slide animates on button/keyboard/volume/swipe with edge shadow.
4. Fade dissolves with no flash on open.
5. `git status` shows NO changes under `client/public/foliate-js/`.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test(reader): verify page-turn transition"
```
