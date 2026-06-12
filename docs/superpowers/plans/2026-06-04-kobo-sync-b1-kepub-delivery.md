# Kobo Sync B-1: KEPUB Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the user's library to the Kobo as KEPUB (via kepubify) instead of plain EPUB, so highlights made on the device carry `koboSpan` markers, the prerequisite for the exact CFI anchoring in B-3.

**Architecture:** A small `epub/kepub.js` module shells out to the `kepubify` binary to convert an EPUB to a KEPUB, writing the result to a deterministic cached path next to the stored book. The Kobo download route generates the KEPUB lazily on first request, caches it, and serves it; if conversion fails it falls back to the original EPUB so books always remain downloadable. The sync changelist now advertises `Format: "KEPUB"` and a `/download/:id/kepub` URL.

**Tech Stack:** Node + Express (ESM, JSDoc types) + better-sqlite3; `kepubify` (pgaskin) external binary; vitest + supertest. Builds on sub-project A (already on `main`).

---

## Scoping notes (read first)

- **No new DB column.** The KEPUB path is deterministic (`<dataDir>/books/<userId>/<bookId>.kepub.epub`); we check the filesystem rather than tracking `kepub_path` in SQLite. Books are immutable once uploaded, so there is no staleness concern. (The design doc mentioned a `kepub_path` column; the deterministic path is simpler and equivalent. YAGNI.)
- **Lazy on download.** The KEPUB is built the first time the device downloads that book, then cached. First-download latency (a few seconds for a large book) is acceptable; subsequent downloads are instant. No locking is added for concurrent first-downloads of the same book (rare; the cache copy is the last writer). A follow-up can add an in-flight guard if needed.
- **Graceful fallback.** If `kepubify` is missing or fails, the download route serves the original EPUB. The device still gets a readable book (without koboSpans); B-3's anchoring will fall back to text for those.
- **Deploy dependency.** Real conversion requires the `kepubify` binary on the server host / in the Docker image, on `PATH` or pointed to by `KEPUBIFY_BIN`. This is a deploy step, validated on the device, not a unit test.
- `removeBookFiles` already deletes every `<bookId>.*` file, so cached KEPUBs are cleaned up when a book is deleted. No change needed there.

## File structure

Create:
- `server/src/epub/kepub.js` - `toKepub(epubPath, outPath, opts)` (spawn kepubify) and `ensureKepub(dataDir, userId, book, opts)` (lazy cache wrapper).
- `server/tests/fixtures/fake-kepubify.mjs` - a tiny executable stand-in for the kepubify CLI, used by tests so they do not depend on the real binary.
- Tests: `server/tests/kepub.test.js`, `server/tests/kobo.download.test.js`.

Modify:
- `server/src/storage.js` - add `kepubPath(dataDir, userId, bookId)`.
- `server/src/config.js` - add `kepubifyBin`.
- `server/src/kobo/serializers.js` - `downloadUrls` advertises `KEPUB` + `/kepub` URL.
- `server/tests/kobo.serializers.test.js` - update the two download-URL expectations.
- `server/src/routes/kobo.js` - download route serves KEPUB (lazy) with EPUB fallback.

---

## Task 1: Storage path helper + config

**Files:**
- Modify: `server/src/storage.js`
- Modify: `server/src/config.js`
- Test: `server/tests/kepub.storage.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kepub.storage.test.js
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { kepubPath } from '../src/storage.js';

describe('kepubPath', () => {
  it('builds <dataDir>/books/<userId>/<bookId>.kepub.epub', () => {
    expect(kepubPath('/data', 7, 42)).toBe(path.join('/data', 'books', '7', '42.kepub.epub'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kepub.storage.test.js`
Expected: FAIL (`kepubPath` is not exported).

- [ ] **Step 3: Add the helper and config**

In `server/src/storage.js`, add after `bookPath`:

```js
export function kepubPath(dataDir, userId, bookId) {
  return path.join(dataDir, 'books', String(userId), `${bookId}.kepub.epub`);
}
```

In `server/src/config.js`, add to the `config` object:

```js
  // External kepubify binary used to convert EPUB -> KEPUB for the Kobo.
  // Must be on PATH in production or set to an absolute path.
  kepubifyBin: process.env.KEPUBIFY_BIN || 'kepubify',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kepub.storage.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/storage.js server/src/config.js server/tests/kepub.storage.test.js
git commit -m "feat(kobo): add kepub path helper and kepubify config"
```

---

## Task 2: `toKepub` (spawn kepubify) + fake binary fixture

**Files:**
- Create: `server/src/epub/kepub.js`
- Create: `server/tests/fixtures/fake-kepubify.mjs`
- Test: `server/tests/kepub.test.js`

- [ ] **Step 1: Create the fake kepubify fixture**

`server/tests/fixtures/fake-kepubify.mjs` (a stand-in for the real CLI so tests do not need kepubify installed; mimics `kepubify --output <dir> <input.epub>` by writing `<dir>/<base>.kepub.epub` with a `KEPUB\n` marker prepended):

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let outDir = null;
let input = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' || args[i] === '-o') { outDir = args[++i]; }
  else { input = args[i]; }
}
if (!outDir || !input) { process.stderr.write('usage: --output <dir> <input>\n'); process.exit(2); }
const base = path.basename(input).replace(/\.epub$/i, '');
const out = path.join(outDir, `${base}.kepub.epub`);
const data = fs.readFileSync(input);
fs.writeFileSync(out, Buffer.concat([Buffer.from('KEPUB\n'), data]));
process.exit(0);
```

- [ ] **Step 2: Write the failing test**

```js
// server/tests/kepub.test.js
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toKepub, ensureKepub } from '../src/epub/kepub.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_BIN = path.join(__dirname, 'fixtures', 'fake-kepubify.mjs');

beforeAll(() => fs.chmodSync(FAKE_BIN, 0o755));

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kepub-test-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('toKepub', () => {
  it('converts an epub to the given output path', async () => {
    const epub = path.join(tmp, 'book.epub');
    fs.writeFileSync(epub, 'ORIGINAL-EPUB-BYTES');
    const out = path.join(tmp, 'out.kepub.epub');
    const result = await toKepub(epub, out, { bin: FAKE_BIN });
    expect(result).toBe(out);
    const written = fs.readFileSync(out, 'utf-8');
    expect(written.startsWith('KEPUB\n')).toBe(true);
    expect(written).toContain('ORIGINAL-EPUB-BYTES');
  });

  it('rejects when the binary cannot be run', async () => {
    const epub = path.join(tmp, 'book.epub');
    fs.writeFileSync(epub, 'x');
    await expect(
      toKepub(epub, path.join(tmp, 'out.kepub.epub'), { bin: '/nonexistent/kepubify' })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kepub.test.js`
Expected: FAIL (cannot find module `../src/epub/kepub.js`).

- [ ] **Step 4: Implement `server/src/epub/kepub.js`**

```js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { bookPath, kepubPath } from '../storage.js';

/**
 * Convert an EPUB to a KEPUB at `outPath` using the kepubify binary.
 * kepubify writes into an output directory, so we run it against a temp dir
 * and copy the produced `*.kepub.epub` to the canonical `outPath`. This is
 * robust to kepubify's output-naming.
 * @param {string} epubPath
 * @param {string} outPath
 * @param {{ bin?: string }} [opts]
 * @returns {Promise<string>} resolves to outPath
 */
export async function toKepub(epubPath, outPath, opts = {}) {
  const bin = opts.bin || config.kepubifyBin;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kepubify-'));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(bin, ['--output', tmpDir, epubPath], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`kepubify exited ${code}`))));
    });
    const files = fs.readdirSync(tmpDir);
    const produced = files.find((f) => f.endsWith('.kepub.epub')) || files[0];
    if (!produced) throw new Error('kepubify produced no output');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(path.join(tmpDir, produced), outPath);
    return outPath;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Return the cached KEPUB path for a book, generating it on first use.
 * @param {string} dataDir
 * @param {number} userId
 * @param {{ id: number, format?: string }} book
 * @param {{ bin?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function ensureKepub(dataDir, userId, book, opts = {}) {
  const out = kepubPath(dataDir, userId, book.id);
  if (fs.existsSync(out)) return out;
  const epub = bookPath(dataDir, userId, book.id, book.format || 'epub');
  await toKepub(epub, out, opts);
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kepub.test.js`
Expected: PASS (2 `toKepub` tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/epub/kepub.js server/tests/fixtures/fake-kepubify.mjs server/tests/kepub.test.js
git commit -m "feat(kobo): add kepubify wrapper (toKepub + ensureKepub)"
```

---

## Task 3: `ensureKepub` lazy cache behavior

**Files:**
- Test: `server/tests/kepub.test.js` (extend)

`ensureKepub` is already implemented in Task 2. This task adds tests proving the cache semantics: it generates once, and a second call returns the cached file without invoking the binary (verified by pointing the binary at a bad path on the second call and still succeeding).

- [ ] **Step 1: Add the failing tests**

Append to `server/tests/kepub.test.js` (inside the file, after the `toKepub` describe block):

```js
describe('ensureKepub', () => {
  it('generates on first call and caches on subsequent calls', async () => {
    fs.mkdirSync(path.join(tmp, 'books', '5'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'books', '5', '9.epub'), 'EPUBDATA');
    const book = { id: 9, format: 'epub' };

    const first = await ensureKepub(tmp, 5, book, { bin: FAKE_BIN });
    expect(first).toBe(path.join(tmp, 'books', '5', '9.kepub.epub'));
    expect(fs.existsSync(first)).toBe(true);

    // Second call must hit the cache: even with a broken binary it succeeds,
    // proving kepubify was not run again.
    const second = await ensureKepub(tmp, 5, book, { bin: '/nonexistent/kepubify' });
    expect(second).toBe(first);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

`ensureKepub` already exists, so this should pass immediately:
Run: `cd server && npx vitest run tests/kepub.test.js`
Expected: PASS (3 tests total: 2 toKepub + 1 ensureKepub).

(If the `ensureKepub` test fails, fix `server/src/epub/kepub.js` from Task 2 until it passes; do not weaken the test.)

- [ ] **Step 3: Commit**

```bash
git add server/tests/kepub.test.js
git commit -m "test(kobo): cover ensureKepub lazy-cache behavior"
```

---

## Task 4: Advertise KEPUB in the sync changelist

**Files:**
- Modify: `server/src/kobo/serializers.js`
- Modify: `server/tests/kobo.serializers.test.js`

- [ ] **Step 1: Update the failing test**

In `server/tests/kobo.serializers.test.js`, change the `downloadUrls` test and the `getMetadata` download-url assertion to expect KEPUB:

Replace the `downloadUrls points at our download route with EPUB format` test body with:

```js
  it('downloadUrls points at our download route with KEPUB format', () => {
    const [d] = downloadUrls(BASE, TOKEN, book);
    expect(d.Format).toBe('KEPUB');
    expect(d.Size).toBe(1234);
    expect(d.Platform).toBe('Generic');
    expect(d.Url).toBe('https://lib.example/kobo/abc123/download/7/kepub');
  });
```

And in the `metadata carries title, contributors, and download urls` test, change:

```js
    expect(m.DownloadUrls[0].Url).toContain('/download/7/epub');
```

to:

```js
    expect(m.DownloadUrls[0].Url).toContain('/download/7/kepub');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.serializers.test.js`
Expected: FAIL (Format is still `EPUB`, URL still ends `/epub`).

- [ ] **Step 3: Update `downloadUrls`**

In `server/src/kobo/serializers.js`, change the `downloadUrls` function:

```js
/** @param {string} baseUrl @param {string} token @param {{ id:number, file_size?:number }} book */
export function downloadUrls(baseUrl, token, book) {
  return [{
    Format: 'KEPUB',
    Size: book.file_size || 0,
    Url: `${baseUrl}/kobo/${token}/download/${book.id}/kepub`,
    Platform: 'Generic',
  }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.serializers.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/kobo/serializers.js server/tests/kobo.serializers.test.js
git commit -m "feat(kobo): advertise KEPUB download format to the device"
```

---

## Task 5: Download route serves KEPUB with EPUB fallback

**Files:**
- Modify: `server/src/routes/kobo.js`
- Test: `server/tests/kobo.download.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kobo.download.test.js
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { createKoboRouter } from '../src/routes/kobo.js';
import { ensureUserDir, bookPath } from '../src/storage.js';
import { config } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_BIN = path.join(__dirname, 'fixtures', 'fake-kepubify.mjs');
beforeAll(() => fs.chmodSync(FAKE_BIN, 0o755));

let tmp, db, user, token, app, bookId;
const savedBin = config.kepubifyBin;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobo-dl-'));
  db = makeDb();
  user = insertUser(db);
  token = createDevice(db, user.id).token;
  bookId = db.prepare("INSERT INTO books (user_id, title, file_path, file_size, format) VALUES (?, 'Dune', 'p', 8, 'epub')").run(user.id).lastInsertRowid;
  ensureUserDir(tmp, user.id);
  fs.writeFileSync(bookPath(tmp, user.id, bookId, 'epub'), 'EPUBBYTES');
  app = express();
  app.use(express.json());
  app.use('/kobo/:authToken', createKoboRouter(db, tmp));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  config.kepubifyBin = savedBin;
});

describe('kobo kepub download', () => {
  it('serves a generated KEPUB when format=kepub', async () => {
    config.kepubifyBin = FAKE_BIN;
    const res = await request(app).get(`/kobo/${token}/download/${bookId}/kepub`);
    expect(res.status).toBe(200);
    expect(res.text.startsWith('KEPUB\n')).toBe(true);
    expect(res.text).toContain('EPUBBYTES');
    // The generated kepub is cached on disk.
    expect(fs.existsSync(bookPath(tmp, user.id, bookId, 'kepub.epub'))).toBe(true);
  });

  it('falls back to the original EPUB when kepubify fails', async () => {
    config.kepubifyBin = '/nonexistent/kepubify';
    const res = await request(app).get(`/kobo/${token}/download/${bookId}/kepub`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('EPUBBYTES');
  });

  it('still serves the raw EPUB for format=epub', async () => {
    const res = await request(app).get(`/kobo/${token}/download/${bookId}/epub`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('EPUBBYTES');
  });
});
```

Note: `bookPath(tmp, user.id, bookId, 'kepub.epub')` yields `<tmp>/books/<userId>/<bookId>.kepub.epub`, the same path `kepubPath` produces.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.download.test.js`
Expected: FAIL (the `kepub` request currently 404s or serves the wrong bytes, because the route does not handle kepub yet).

- [ ] **Step 3: Update the download route**

In `server/src/routes/kobo.js`, add the import near the other imports at the top of the file:

```js
import { ensureKepub } from '../epub/kepub.js';
```

Replace the existing download route:

```js
  // GET /download/:bookId/:format -> the stored book file
  r.get('/download/:bookId/:format', (req, res) => {
    const id = Number(req.params.bookId);
    if (!Number.isInteger(id)) return res.status(404).end();
    const book = db.prepare('SELECT id, format FROM books WHERE id = ? AND user_id = ?').get(id, req.koboUserId);
    if (!book) return res.status(404).end();
    const file = bookPath(dataDir, req.koboUserId, book.id, book.format || 'epub');
    res.type('application/epub+zip').sendFile(path.resolve(file));
  });
```

with:

```js
  // GET /download/:bookId/:format -> the book file. For format=kepub we serve a
  // lazily-generated, cached KEPUB; if conversion fails we fall back to the
  // original EPUB so the book always downloads.
  r.get('/download/:bookId/:format', async (req, res) => {
    const id = Number(req.params.bookId);
    if (!Number.isInteger(id)) return res.status(404).end();
    const book = db.prepare('SELECT id, format FROM books WHERE id = ? AND user_id = ?').get(id, req.koboUserId);
    if (!book) return res.status(404).end();

    if (req.params.format === 'kepub') {
      try {
        const kpath = await ensureKepub(dataDir, req.koboUserId, book);
        return res.type('application/epub+zip').sendFile(path.resolve(kpath));
      } catch (err) {
        console.error(`kepub conversion failed for book ${book.id}, serving epub:`, err.message);
        // fall through to the EPUB
      }
    }

    const file = bookPath(dataDir, req.koboUserId, book.id, book.format || 'epub');
    res.type('application/epub+zip').sendFile(path.resolve(file));
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.download.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite**

Run: `cd server && npx vitest run`
Expected: PASS (all existing + new tests green; the basic-route `download serves the stored epub bytes` test still passes because the `epub` branch is unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/kobo.js server/tests/kobo.download.test.js
git commit -m "feat(kobo): serve lazily-generated KEPUB with EPUB fallback"
```

---

## Task 6: Deploy + device validation notes

Not a code task; record what is needed to run B-1 against the real device. Check the boxes as done.

- [ ] **Step 1:** Install `kepubify` on the server host / Docker image (download the static binary from https://github.com/pgaskin/kepubify/releases, put it on `PATH`, or set `KEPUBIFY_BIN` to its absolute path). Verify with `kepubify --version`.
- [ ] **Step 2:** Deploy the branch (backend restart via Jose per `OPS.md`).
- [ ] **Step 3:** On the Kobo, remove the previously-synced books (they are EPUB) and Sync again so they re-download as KEPUB. Confirm books still open and read normally.
- [ ] **Step 4:** Make a highlight in the stock reader, then over USB inspect `.kobo/KoboReader.sqlite` `Bookmark.StartContainerPath` for that book: it should now reference a `span#kobo.N.M` selector (proof the koboSpans are present). Capture one example value for B-3. If it still looks like an EPUB XPath, the book did not re-download as KEPUB; re-check Step 3 and the `Content-Type` (try `application/x-kobo-epub+zip` if the device refuses the KEPUB).

---

## Done criteria for B-1

- Full vitest suite green (`cd server && npx vitest run`).
- The device downloads books as KEPUB; a stock-reader highlight produces a `span#kobo.*` `StartContainerPath` in `KoboReader.sqlite` (Task 6), which B-3 depends on.
- Conversion failure degrades gracefully to EPUB rather than breaking downloads.
