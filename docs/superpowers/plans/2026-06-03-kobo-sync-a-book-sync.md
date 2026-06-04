# Kobo Sync - Sub-project A: Book + Progress Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user's sideloaded MisLibros library appear on a stock Kobo via the device's own sync, and receive reading progress back, by reimplementing the Kobo sync protocol inside the existing epubReader server.

**Architecture:** A new Express router mounted at `/kobo/:authToken` answers Nickel's REST sync protocol (`/v1/initialization`, `/v1/library/sync`, metadata, download, cover, `/v1/library/:uuid/state`). A path-token (stored in `kobo_devices`) authenticates the device and maps it to one `users.id`. Pure protocol logic (timestamp format, sync-token codec, JSON serializers) lives in small `server/src/kobo/*` modules with unit tests; the router wires them to the existing `books` / `reading_progress` tables. The web app gets a `/api/devices` CRUD endpoint to mint the token and show the `api_endpoint=` line.

**Tech Stack:** Node + Express (ESM JS, JSDoc types) + better-sqlite3; vitest + supertest. Reference wire format: Calibre-Web `cps/kobo.py`.

---

## Scoping notes (read first)

- **kepubify is deferred to sub-project B.** KEPUB is only required for exact highlight anchoring (B). The Kobo reads sideloaded EPUB natively, so A serves the original EPUB with `Format: "EPUB"`. Books downloaded now will be re-downloaded as KEPUB when B lands; that is acceptable.
- **Annotation columns are deferred to sub-project B.** A's migration only adds what A needs.
- **`/v1/initialization` Resources:** we return our own `image_*` and `library_sync` overrides merged over a static base of standard keys pointing at `https://storeapi.kobo.com`. The real device may need more keys; Task 15 (manual device validation) is where we confirm and expand. This is an integration step, not a placeholder.
- **Paging:** A implements the `x-kobo-sync: continue` header with a 100-item page limit (matches Calibre-Web's `SYNC_ITEM_LIMIT`).
- `req.user.sub` is the internal `users.id` (see `tokenFor` in `tests/helpers.js`). All Kobo writes resolve to one `user_id` via the device token.

## File structure

Create:
- `server/src/kobo/format.js` - Kobo timestamp + epoch helpers (pure).
- `server/src/kobo/syncToken.js` - `x-kobo-synctoken` base64-JSON codec (pure).
- `server/src/kobo/devices.js` - `kobo_devices` token CRUD.
- `server/src/kobo/library.js` - book-UUID assignment + sync queries.
- `server/src/kobo/serializers.js` - build entitlement / metadata / reading-state / resources JSON (pure).
- `server/src/middleware/koboAuth.js` - path-token -> user middleware.
- `server/src/routes/kobo.js` - the protocol router (mounted `/kobo/:authToken`).
- `server/src/routes/devices.js` - web-app device CRUD (mounted `/api/devices`).
- Tests: `server/tests/kobo.format.test.js`, `kobo.syncToken.test.js`, `kobo.devices.test.js`, `kobo.serializers.test.js`, `routes.devices.test.js`, `routes.kobo.sync.test.js`, `routes.kobo.state.test.js`.

Modify:
- `server/src/db.js` - schema migrations (Task 1).
- `server/src/config.js` - add `publicUrl` (Task 2).
- `server/src/app.js` - mount the two routers (Task 14).

---

## Task 1: Schema migration

**Files:**
- Modify: `server/src/db.js`
- Test: `server/tests/kobo.schema.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kobo.schema.test.js
import { describe, it, expect } from 'vitest';
import { makeDb } from './helpers.js';

function cols(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

describe('kobo schema migration', () => {
  it('creates kobo_devices table', () => {
    const db = makeDb();
    const names = cols(db, 'kobo_devices');
    expect(names).toEqual(expect.arrayContaining(['id', 'user_id', 'token', 'name', 'last_seen_at', 'last_db_hash', 'created_at']));
  });

  it('adds kobo columns to books', () => {
    const db = makeDb();
    expect(cols(db, 'books')).toEqual(expect.arrayContaining(['kobo_uuid', 'source']));
  });

  it('adds kobo columns to reading_progress', () => {
    const db = makeDb();
    expect(cols(db, 'reading_progress')).toEqual(
      expect.arrayContaining(['kobo_chapter_id', 'kobo_chapter_progress', 'kobo_location_value', 'source'])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.schema.test.js`
Expected: FAIL (no such table: kobo_devices).

- [ ] **Step 3: Add the migration**

In `server/src/db.js`, append the `kobo_devices` table to the `SCHEMA` string (before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS kobo_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT    UNIQUE NOT NULL,
  name          TEXT,
  last_seen_at  TEXT,
  last_db_hash  TEXT,
  created_at    TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kobo_devices_user ON kobo_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_kobo_devices_token ON kobo_devices(token);
```

Then add these column migrations inside `openDb`, alongside the existing `hasColumn` blocks (before `return db;`):

```js
  // Kobo: stable UUID the device sees + where the book originated.
  if (!hasColumn(db, 'books', 'kobo_uuid')) {
    db.exec('ALTER TABLE books ADD COLUMN kobo_uuid TEXT');
  }
  if (!hasColumn(db, 'books', 'source')) {
    db.exec("ALTER TABLE books ADD COLUMN source TEXT NOT NULL DEFAULT 'web'");
  }
  // Kobo: native reading location alongside the existing CFI position.
  if (!hasColumn(db, 'reading_progress', 'kobo_chapter_id')) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN kobo_chapter_id TEXT');
  }
  if (!hasColumn(db, 'reading_progress', 'kobo_chapter_progress')) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN kobo_chapter_progress REAL');
  }
  if (!hasColumn(db, 'reading_progress', 'kobo_location_value')) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN kobo_location_value TEXT');
  }
  if (!hasColumn(db, 'reading_progress', 'source')) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN source TEXT');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.schema.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/db.js server/tests/kobo.schema.test.js
git commit -m "feat(kobo): add device + book/progress schema for sync"
```

---

## Task 2: Config `publicUrl`

**Files:**
- Modify: `server/src/config.js`

- [ ] **Step 1: Add the field**

In `server/src/config.js`, inside the `config` object, add:

```js
  // External base URL the Kobo device reaches us at (no trailing slash).
  // Used to build absolute DownloadUrls and cover-image templates.
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT || 3001)}`).replace(/\/$/, ''),
```

- [ ] **Step 2: Verify nothing breaks**

Run: `cd server && npx vitest run`
Expected: PASS (existing suite still green).

- [ ] **Step 3: Commit**

```bash
git add server/src/config.js
git commit -m "feat(kobo): add publicUrl config for device-facing URLs"
```

---

## Task 3: Kobo timestamp + epoch helpers

**Files:**
- Create: `server/src/kobo/format.js`
- Test: `server/tests/kobo.format.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kobo.format.test.js
import { describe, it, expect } from 'vitest';
import { toKoboTimestamp, toEpoch, parseDbTime } from '../src/kobo/format.js';

describe('kobo/format', () => {
  it('formats a Date as ISO-8601 with trailing Z', () => {
    expect(toKoboTimestamp(new Date('2026-06-03T12:00:00.000Z'))).toBe('2026-06-03T12:00:00.000Z');
  });

  it('treats a bare SQLite timestamp as UTC, not local', () => {
    // '2026-06-03 12:00:00' from CURRENT_TIMESTAMP is UTC.
    expect(toKoboTimestamp('2026-06-03 12:00:00')).toBe('2026-06-03T12:00:00.000Z');
    expect(toEpoch('2026-06-03 12:00:00')).toBe(Math.floor(Date.UTC(2026, 5, 3, 12, 0, 0) / 1000));
  });

  it('toEpoch returns 0 for null/empty', () => {
    expect(toEpoch(null)).toBe(0);
    expect(parseDbTime(null)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.format.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

```js
// server/src/kobo/format.js

/**
 * Parse a value into a Date. SQLite `CURRENT_TIMESTAMP` produces
 * 'YYYY-MM-DD HH:MM:SS' in UTC but without a zone; JS Date would read that as
 * local time, so we normalise it to explicit UTC.
 * @param {string|Date|null|undefined} value
 * @returns {Date|null}
 */
export function parseDbTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a value as a Kobo timestamp (ISO-8601 UTC with milliseconds + 'Z').
 * Falls back to "now" when the value is empty.
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
export function toKoboTimestamp(value) {
  const d = parseDbTime(value) || new Date();
  return d.toISOString();
}

/**
 * Unix epoch seconds for a value, or 0 when empty/unparseable.
 * @param {string|Date|null|undefined} value
 * @returns {number}
 */
export function toEpoch(value) {
  const d = parseDbTime(value);
  return d ? Math.floor(d.getTime() / 1000) : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.format.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/kobo/format.js server/tests/kobo.format.test.js
git commit -m "feat(kobo): add timestamp/epoch helpers"
```

---

## Task 4: Sync-token codec

**Files:**
- Create: `server/src/kobo/syncToken.js`
- Test: `server/tests/kobo.syncToken.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kobo.syncToken.test.js
import { describe, it, expect } from 'vitest';
import { parseSyncToken, buildSyncToken, SYNC_TOKEN_HEADER, EMPTY_TOKEN } from '../src/kobo/syncToken.js';

describe('kobo/syncToken', () => {
  it('header name is correct', () => {
    expect(SYNC_TOKEN_HEADER).toBe('x-kobo-synctoken');
  });

  it('parses an empty/missing header to zeroed data', () => {
    expect(parseSyncToken(undefined)).toEqual(EMPTY_TOKEN);
    expect(parseSyncToken('')).toEqual(EMPTY_TOKEN);
  });

  it('round-trips data through build -> parse', () => {
    const built = buildSyncToken({ books_last_created: 1700000000, reading_state_last_modified: 1700000500 });
    const parsed = parseSyncToken(built);
    expect(parsed.books_last_created).toBe(1700000000);
    expect(parsed.reading_state_last_modified).toBe(1700000500);
    expect(parsed.tags_last_modified).toBe(0);
  });

  it('tolerates malformed base64 by returning the empty token', () => {
    expect(parseSyncToken('!!!not-base64!!!')).toEqual(EMPTY_TOKEN);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.syncToken.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

```js
// server/src/kobo/syncToken.js
import { Buffer } from 'node:buffer';

export const SYNC_TOKEN_HEADER = 'x-kobo-synctoken';
const VERSION = '1-1-0';

/** @typedef {{ raw_kobo_store_token: string, books_last_modified: number, books_last_created: number, archive_last_modified: number, reading_state_last_modified: number, tags_last_modified: number }} SyncTokenData */

/** @type {SyncTokenData} */
export const EMPTY_TOKEN = Object.freeze({
  raw_kobo_store_token: '',
  books_last_modified: 0,
  books_last_created: 0,
  archive_last_modified: 0,
  reading_state_last_modified: 0,
  tags_last_modified: 0,
});

/**
 * Decode the `x-kobo-synctoken` request header into token data.
 * @param {string|undefined} headerValue
 * @returns {SyncTokenData}
 */
export function parseSyncToken(headerValue) {
  if (!headerValue) return { ...EMPTY_TOKEN };
  try {
    const pad = '='.repeat((4 - (headerValue.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(headerValue + pad, 'base64').toString('utf-8'));
    return { ...EMPTY_TOKEN, ...(json && json.data ? json.data : {}) };
  } catch {
    return { ...EMPTY_TOKEN };
  }
}

/**
 * Encode token data into a base64 `x-kobo-synctoken` value.
 * @param {Partial<SyncTokenData>} data
 * @returns {string}
 */
export function buildSyncToken(data) {
  const token = { version: VERSION, data: { ...EMPTY_TOKEN, ...data } };
  return Buffer.from(JSON.stringify(token), 'utf-8').toString('base64');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.syncToken.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/kobo/syncToken.js server/tests/kobo.syncToken.test.js
git commit -m "feat(kobo): add x-kobo-synctoken codec"
```

---

## Task 5: Device token CRUD

**Files:**
- Create: `server/src/kobo/devices.js`
- Test: `server/tests/kobo.devices.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kobo.devices.test.js
import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice, findUserIdByToken, touchDevice, listDevices, deleteDevice } from '../src/kobo/devices.js';

describe('kobo/devices', () => {
  it('creates a device with a 32-hex token and resolves it to the user', () => {
    const db = makeDb();
    const user = insertUser(db);
    const dev = createDevice(db, user.id, 'My Libra');
    expect(dev.token).toMatch(/^[0-9a-f]{32}$/);
    expect(findUserIdByToken(db, dev.token)).toBe(user.id);
    expect(findUserIdByToken(db, 'nope')).toBe(null);
  });

  it('touchDevice sets last_seen_at', () => {
    const db = makeDb();
    const user = insertUser(db);
    const dev = createDevice(db, user.id);
    touchDevice(db, dev.token);
    const row = db.prepare('SELECT last_seen_at FROM kobo_devices WHERE token = ?').get(dev.token);
    expect(row.last_seen_at).toBeTruthy();
  });

  it('lists and deletes only the owner\'s devices', () => {
    const db = makeDb();
    const a = insertUser(db);
    const b = insertUser(db, { google_sub: 'b', email: 'b@e.com' });
    const devA = createDevice(db, a.id);
    createDevice(db, b.id);
    expect(listDevices(db, a.id)).toHaveLength(1);
    expect(deleteDevice(db, b.id, devA.id)).toBe(0); // not owner
    expect(deleteDevice(db, a.id, devA.id)).toBe(1);
    expect(listDevices(db, a.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.devices.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

```js
// server/src/kobo/devices.js
import crypto from 'node:crypto';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {string|null} [name]
 * @returns {{ id: number, userId: number, token: string, name: string|null }}
 */
export function createDevice(db, userId, name = null) {
  const token = crypto.randomBytes(16).toString('hex');
  const info = db.prepare(
    'INSERT INTO kobo_devices (user_id, token, name) VALUES (?, ?, ?)'
  ).run(userId, token, name);
  return { id: Number(info.lastInsertRowid), userId, token, name };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} token
 * @returns {number|null}
 */
export function findUserIdByToken(db, token) {
  const row = db.prepare('SELECT user_id FROM kobo_devices WHERE token = ?').get(token);
  return row ? row.user_id : null;
}

/** @param {import('better-sqlite3').Database} db @param {string} token */
export function touchDevice(db, token) {
  db.prepare("UPDATE kobo_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?").run(token);
}

/** @param {import('better-sqlite3').Database} db @param {number} userId */
export function listDevices(db, userId) {
  return db.prepare(
    'SELECT id, name, token, last_seen_at, created_at FROM kobo_devices WHERE user_id = ? ORDER BY id'
  ).all(userId);
}

/**
 * @param {import('better-sqlite3').Database} db @param {number} userId @param {number} id
 * @returns {number} rows deleted (0 if not owner)
 */
export function deleteDevice(db, userId, id) {
  return db.prepare('DELETE FROM kobo_devices WHERE id = ? AND user_id = ?').run(id, userId).changes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.devices.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/kobo/devices.js server/tests/kobo.devices.test.js
git commit -m "feat(kobo): add device token CRUD"
```

---

## Task 6: koboAuth middleware

**Files:**
- Create: `server/src/middleware/koboAuth.js`
- Test: `server/tests/kobo.middleware.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kobo.middleware.test.js
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { makeKoboAuth } from '../src/middleware/koboAuth.js';

function appWith(db) {
  const app = express();
  const r = express.Router({ mergeParams: true });
  r.use(makeKoboAuth(db));
  r.get('/whoami', (req, res) => res.json({ userId: req.koboUserId }));
  app.use('/kobo/:authToken', r);
  return app;
}

describe('koboAuth', () => {
  it('resolves a valid token to the user and touches last_seen', async () => {
    const db = makeDb();
    const user = insertUser(db);
    const dev = createDevice(db, user.id);
    const res = await request(appWith(db)).get(`/kobo/${dev.token}/whoami`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(user.id);
    const row = db.prepare('SELECT last_seen_at FROM kobo_devices WHERE token = ?').get(dev.token);
    expect(row.last_seen_at).toBeTruthy();
  });

  it('401s an unknown token', async () => {
    const db = makeDb();
    const res = await request(appWith(db)).get('/kobo/deadbeef/whoami');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.middleware.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

```js
// server/src/middleware/koboAuth.js
import { findUserIdByToken, touchDevice } from '../kobo/devices.js';

/**
 * Build middleware that authenticates a Kobo device by its URL-path token.
 * Sets `req.koboUserId` and `req.koboToken`. The device sends no bearer token;
 * the path token IS the credential.
 * @param {import('better-sqlite3').Database} db
 */
export function makeKoboAuth(db) {
  return function koboAuth(req, res, next) {
    const token = req.params.authToken;
    const userId = token ? findUserIdByToken(db, token) : null;
    if (!userId) return res.status(401).json({ error: 'invalid_kobo_token' });
    touchDevice(db, token);
    req.koboUserId = userId;
    req.koboToken = token;
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.middleware.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/koboAuth.js server/tests/kobo.middleware.test.js
git commit -m "feat(kobo): add path-token auth middleware"
```

---

## Task 7: Book UUID + sync queries

**Files:**
- Create: `server/src/kobo/library.js`
- Test: `server/tests/kobo.library.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kobo.library.test.js
import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';
import { ensureBookUuid, listSyncBooks, getBookByUuid } from '../src/kobo/library.js';

function insertBook(db, userId, title) {
  return db.prepare(
    "INSERT INTO books (user_id, title, file_path, format) VALUES (?, ?, 'x', 'epub')"
  ).run(userId, title).lastInsertRowid;
}

describe('kobo/library', () => {
  it('assigns a stable UUID once', () => {
    const db = makeDb();
    const user = insertUser(db);
    const id = insertBook(db, user.id, 'Book');
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    const uuid1 = ensureBookUuid(db, book);
    expect(uuid1).toMatch(/^[0-9a-f-]{36}$/);
    const book2 = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    expect(ensureBookUuid(db, book2)).toBe(uuid1); // stable
  });

  it('lists books for a user and finds one by uuid', () => {
    const db = makeDb();
    const user = insertUser(db);
    const id = insertBook(db, user.id, 'Book');
    const uuid = ensureBookUuid(db, db.prepare('SELECT * FROM books WHERE id = ?').get(id));
    expect(listSyncBooks(db, user.id)).toHaveLength(1);
    expect(getBookByUuid(db, user.id, uuid).id).toBe(id);
    expect(getBookByUuid(db, user.id, 'missing')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.library.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

```js
// server/src/kobo/library.js
import crypto from 'node:crypto';

/**
 * Return the book's Kobo UUID, generating and persisting one on first use.
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: number, kobo_uuid?: string|null }} book
 * @returns {string}
 */
export function ensureBookUuid(db, book) {
  if (book.kobo_uuid) return book.kobo_uuid;
  const uuid = crypto.randomUUID();
  db.prepare('UPDATE books SET kobo_uuid = ? WHERE id = ?').run(uuid, book.id);
  return uuid;
}

/** @param {import('better-sqlite3').Database} db @param {number} userId */
export function listSyncBooks(db, userId) {
  return db.prepare('SELECT * FROM books WHERE user_id = ? ORDER BY id').all(userId);
}

/** @param {import('better-sqlite3').Database} db @param {number} userId @param {string} uuid */
export function getBookByUuid(db, userId, uuid) {
  return db.prepare('SELECT * FROM books WHERE kobo_uuid = ? AND user_id = ?').get(uuid, userId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.library.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/kobo/library.js server/tests/kobo.library.test.js
git commit -m "feat(kobo): add book-uuid and sync queries"
```

---

## Task 8: Protocol serializers

**Files:**
- Create: `server/src/kobo/serializers.js`
- Test: `server/tests/kobo.serializers.test.js`

Field names are copied verbatim from Calibre-Web `cps/kobo.py` (`create_book_entitlement`, `get_metadata`, `get_kobo_reading_state_response`).

- [ ] **Step 1: Write the failing test**

```js
// server/tests/kobo.serializers.test.js
import { describe, it, expect } from 'vitest';
import {
  downloadUrls, createBookEntitlement, getMetadata,
  getReadingStateResponse, koboResources,
} from '../src/kobo/serializers.js';

const BASE = 'https://lib.example';
const TOKEN = 'abc123';
const book = {
  id: 7, title: 'Dune', author: 'Frank Herbert',
  file_size: 1234, uploaded_at: '2026-06-03 12:00:00',
};
const UUID = '11111111-1111-1111-1111-111111111111';

describe('kobo/serializers', () => {
  it('downloadUrls points at our download route with EPUB format', () => {
    const [d] = downloadUrls(BASE, TOKEN, book);
    expect(d.Format).toBe('EPUB');
    expect(d.Size).toBe(1234);
    expect(d.Platform).toBe('Generic');
    expect(d.Url).toBe('https://lib.example/kobo/abc123/download/7/epub');
  });

  it('entitlement uses the uuid for all id fields and is Active', () => {
    const e = createBookEntitlement(book, UUID);
    expect(e.Id).toBe(UUID);
    expect(e.CrossRevisionId).toBe(UUID);
    expect(e.RevisionId).toBe(UUID);
    expect(e.Status).toBe('Active');
    expect(e.IsRemoved).toBe(false);
    expect(e.Created).toBe('2026-06-03T12:00:00.000Z');
  });

  it('metadata carries title, contributors, and download urls', () => {
    const m = getMetadata(BASE, TOKEN, book, UUID);
    expect(m.Title).toBe('Dune');
    expect(m.WorkId).toBe(UUID);
    expect(m.CoverImageId).toBe(UUID);
    expect(m.Contributors).toEqual(['Frank Herbert']);
    expect(m.DownloadUrls[0].Url).toContain('/download/7/epub');
  });

  it('reading-state maps stored progress into CurrentBookmark', () => {
    const rs = getReadingStateResponse(UUID, {
      percentage: 0.5, kobo_chapter_progress: 0.25,
      kobo_chapter_id: 'ch3', kobo_location_value: 'span#kobo.3.1',
      last_read_at: '2026-06-03 12:00:00',
    });
    expect(rs.EntitlementId).toBe(UUID);
    expect(rs.CurrentBookmark.ProgressPercent).toBe(25);
    expect(rs.CurrentBookmark.ContentSourceProgressPercent).toBe(50);
    expect(rs.CurrentBookmark.Location).toEqual({ Value: 'span#kobo.3.1', Type: 'KoboSpan', Source: 'ch3' });
    expect(rs.StatusInfo.Status).toBe('Reading');
  });

  it('resources override image + sync URLs to point at us', () => {
    const r = koboResources(BASE, TOKEN);
    expect(r.image_url_template).toBe('https://lib.example/kobo/abc123/{ImageId}/{width}/{height}/false/image.jpg');
    expect(r.library_sync).toBe('https://lib.example/kobo/abc123/v1/library/sync');
    expect(r.image_host).toBe('https://lib.example');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/kobo.serializers.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

```js
// server/src/kobo/serializers.js
import { toKoboTimestamp } from './format.js';

const STORE = 'https://storeapi.kobo.com';

/** @param {string} baseUrl @param {string} token @param {{ id:number, file_size?:number }} book */
export function downloadUrls(baseUrl, token, book) {
  return [{
    Format: 'EPUB',
    Size: book.file_size || 0,
    Url: `${baseUrl}/kobo/${token}/download/${book.id}/epub`,
    Platform: 'Generic',
  }];
}

/** @param {{ uploaded_at?:string }} book @param {string} uuid */
export function createBookEntitlement(book, uuid) {
  const created = toKoboTimestamp(book.uploaded_at);
  return {
    Accessibility: 'Full',
    ActivePeriod: { From: toKoboTimestamp(new Date()) },
    Created: created,
    CrossRevisionId: uuid,
    Id: uuid,
    IsRemoved: false,
    IsHiddenFromArchive: false,
    IsLocked: false,
    LastModified: created,
    OriginCategory: 'Imported',
    RevisionId: uuid,
    Status: 'Active',
  };
}

/** @param {string} baseUrl @param {string} token @param {{ id:number, title:string, author?:string|null, uploaded_at?:string, file_size?:number }} book @param {string} uuid */
export function getMetadata(baseUrl, token, book, uuid) {
  const contributors = book.author ? [book.author] : [];
  return {
    Categories: ['00000000-0000-0000-0000-000000000001'],
    CoverImageId: uuid,
    CrossRevisionId: uuid,
    CurrentDisplayPrice: { CurrencyCode: 'USD', TotalAmount: 0 },
    CurrentLoveDisplayPrice: { TotalAmount: 0 },
    Description: '',
    DownloadUrls: downloadUrls(baseUrl, token, book),
    EntitlementId: uuid,
    ExternalIds: [],
    Genre: '00000000-0000-0000-0000-000000000001',
    IsEligibleForKoboLove: false,
    IsInternetArchive: false,
    IsPreOrder: false,
    IsSocialEnabled: true,
    Language: 'en',
    PhoneticPronunciations: {},
    PublicationDate: toKoboTimestamp(book.uploaded_at),
    Publisher: { Imprint: '', Name: '' },
    RevisionId: uuid,
    Title: book.title,
    WorkId: uuid,
    Contributors: contributors,
    ContributorRoles: contributors.map((name) => ({ Name: name })),
  };
}

/** @param {{ percentage?:number }} [progress] */
function statusFromProgress(progress) {
  if (!progress || !progress.percentage) return 'ReadyToRead';
  if (progress.percentage >= 0.99) return 'Finished';
  return 'Reading';
}

/**
 * @param {string} uuid
 * @param {{ percentage?:number, kobo_chapter_progress?:number, kobo_chapter_id?:string|null, kobo_location_value?:string|null, last_read_at?:string }} [progress]
 */
export function getReadingStateResponse(uuid, progress) {
  const now = toKoboTimestamp(progress && progress.last_read_at ? progress.last_read_at : new Date());
  const bookmark = { LastModified: now };
  if (progress) {
    if (progress.kobo_chapter_progress != null) {
      bookmark.ProgressPercent = Math.round(progress.kobo_chapter_progress * 100);
    }
    if (progress.percentage != null) {
      bookmark.ContentSourceProgressPercent = Math.round(progress.percentage * 100);
    }
    if (progress.kobo_location_value) {
      bookmark.Location = {
        Value: progress.kobo_location_value,
        Type: 'KoboSpan',
        Source: progress.kobo_chapter_id || '',
      };
    }
  }
  return {
    EntitlementId: uuid,
    Created: now,
    LastModified: now,
    PriorityTimestamp: now,
    StatusInfo: { LastModified: now, Status: statusFromProgress(progress), TimesStartedReading: 0 },
    Statistics: { LastModified: now },
    CurrentBookmark: bookmark,
  };
}

/**
 * Resources for /v1/initialization. Our image + sync URLs point at us; the rest
 * point at the real Kobo store so the firmware does not choke on missing keys.
 * @param {string} baseUrl @param {string} token
 */
export function koboResources(baseUrl, token) {
  const k = `${baseUrl}/kobo/${token}`;
  return {
    account_page: 'https://www.kobo.com/account/settings',
    assets: `${STORE}/v1/assets`,
    book: `${STORE}/v1/products/books/{ProductId}`,
    configuration_data: `${STORE}/v1/configuration`,
    dictionary_host: 'https://kbdownload1-a.akamaihd.net',
    discovery_host: STORE,
    image_host: baseUrl,
    image_url_quality_template: `${k}/{ImageId}/{width}/{height}/{Quality}/false/image.jpg`,
    image_url_template: `${k}/{ImageId}/{width}/{height}/false/image.jpg`,
    library_sync: `${k}/v1/library/sync`,
    oauth_host: STORE,
    products: `${STORE}/v1/products`,
    reading_state: `${STORE}/v1/library/{Ids}/state`,
    store_host: 'www.kobo.com',
    tags: `${k}/v1/library/tags`,
    user_profile: `${STORE}/v1/user/profile`,
    user_wishlist: `${STORE}/v1/user/wishlist`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/kobo.serializers.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/kobo/serializers.js server/tests/kobo.serializers.test.js
git commit -m "feat(kobo): add protocol JSON serializers"
```

---

## Task 9: Devices REST router

**Files:**
- Create: `server/src/routes/devices.js`
- Test: `server/tests/routes.devices.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/routes.devices.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createDevicesRouter } from '../src/routes/devices.js';

let db, user, app;
beforeEach(() => {
  db = makeDb();
  user = insertUser(db);
  app = express();
  app.use(express.json());
  app.use('/api/devices', createDevicesRouter(db));
});

describe('devices routes', () => {
  it('creates a device and returns the api_endpoint', async () => {
    const res = await request(app).post('/api/devices').set(authHeader(user)).send({ name: 'Libra' });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[0-9a-f]{32}$/);
    expect(res.body.apiEndpoint).toContain(`/kobo/${res.body.token}`);
  });

  it('lists then deletes a device', async () => {
    const created = await request(app).post('/api/devices').set(authHeader(user)).send({});
    const list = await request(app).get('/api/devices').set(authHeader(user));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].apiEndpoint).toContain('/kobo/');
    const del = await request(app).delete(`/api/devices/${created.body.id}`).set(authHeader(user));
    expect(del.status).toBe(200);
    const after = await request(app).get('/api/devices').set(authHeader(user));
    expect(after.body).toHaveLength(0);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/devices');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/routes.devices.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Write the implementation**

```js
// server/src/routes/devices.js
import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';
import { createDevice, listDevices, deleteDevice } from '../kobo/devices.js';
import { config } from '../config.js';

/** @param {import('better-sqlite3').Database} db */
export function createDevicesRouter(db) {
  const r = Router();
  r.use(authRequired);

  const endpoint = (token) => `${config.publicUrl}/kobo/${token}`;

  r.get('/', (req, res) => {
    const rows = listDevices(db, req.user.sub).map((d) => ({
      id: d.id,
      name: d.name,
      lastSeenAt: d.last_seen_at,
      createdAt: d.created_at,
      apiEndpoint: endpoint(d.token),
    }));
    res.json(rows);
  });

  r.post('/', (req, res) => {
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null;
    const d = createDevice(db, req.user.sub, name);
    res.json({ id: d.id, name: d.name, token: d.token, apiEndpoint: endpoint(d.token) });
  });

  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).end();
    if (!deleteDevice(db, req.user.sub, id)) return res.status(404).end();
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/routes.devices.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/devices.js server/tests/routes.devices.test.js
git commit -m "feat(kobo): add device management API"
```

---

## Task 10: Kobo router skeleton (init + stubs + cover + download)

**Files:**
- Create: `server/src/routes/kobo.js`
- Test: `server/tests/routes.kobo.basic.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/routes.kobo.basic.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { ensureBookUuid } from '../src/kobo/library.js';
import { createKoboRouter } from '../src/routes/kobo.js';
import { ensureUserDir, bookPath } from '../src/storage.js';

let db, user, token, tmp, app, bookId, uuid;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobo-'));
  db = makeDb();
  user = insertUser(db);
  token = createDevice(db, user.id).token;
  bookId = db.prepare("INSERT INTO books (user_id, title, file_path, file_size, format) VALUES (?, 'Dune', 'p', 10, 'epub')").run(user.id).lastInsertRowid;
  uuid = ensureBookUuid(db, db.prepare('SELECT * FROM books WHERE id = ?').get(bookId));
  ensureUserDir(tmp, user.id);
  fs.writeFileSync(bookPath(tmp, user.id, bookId, 'epub'), 'EPUBBYTES');
  app = express();
  app.use(express.json());
  app.use('/kobo/:authToken', createKoboRouter(db, tmp));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('kobo basic routes', () => {
  it('initialization returns Resources pointing at us', async () => {
    const res = await request(app).get(`/kobo/${token}/v1/initialization`);
    expect(res.status).toBe(200);
    expect(res.body.Resources.library_sync).toContain(`/kobo/${token}/v1/library/sync`);
  });

  it('unknown token is rejected', async () => {
    const res = await request(app).get('/kobo/bad/v1/initialization');
    expect(res.status).toBe(401);
  });

  it('download serves the stored epub bytes', async () => {
    const res = await request(app).get(`/kobo/${token}/download/${bookId}/epub`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('EPUBBYTES');
  });

  it('stub endpoints return empty 200', async () => {
    const res = await request(app).get(`/kobo/${token}/v1/user/profile`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/routes.kobo.basic.test.js`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Write the router skeleton**

```js
// server/src/routes/kobo.js
import { Router } from 'express';
import path from 'node:path';
import { makeKoboAuth } from '../middleware/koboAuth.js';
import { config } from '../config.js';
import { koboResources, getMetadata } from '../kobo/serializers.js';
import { getBookByUuid } from '../kobo/library.js';
import { bookPath } from '../storage.js';

/**
 * Kobo sync protocol router. Mount at `/kobo/:authToken`.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dataDir
 */
export function createKoboRouter(db, dataDir) {
  const r = Router({ mergeParams: true });
  r.use(makeKoboAuth(db));
  const baseUrl = config.publicUrl;

  // Empty/benign responses for store + account endpoints we do not implement.
  const empty = (_req, res) => res.json({});
  r.all('/v1/user/profile', empty);
  r.all('/v1/user/loyalty/benefits', (_req, res) => res.json([]));
  r.all('/v1/user/wishlist', (_req, res) => res.json([]));
  r.all('/v1/user/recommendations', (_req, res) => res.json([]));
  r.all('/v1/analytics/gettests', (_req, res) => res.json({ Result: 'Success', TestKey: '', Tests: {} }));
  r.all(/^\/v1\/analytics\/.*/, empty);
  r.post('/v1/auth/device', empty);
  r.post('/v1/auth/refresh', empty);

  // GET /v1/initialization
  r.get('/v1/initialization', (req, res) => {
    res.set('x-kobo-apitoken', 'e30=');
    res.json({ Resources: koboResources(baseUrl, req.koboToken) });
  });

  // GET /v1/library/:uuid/metadata  -> [metadata]
  r.get('/v1/library/:uuid/metadata', (req, res) => {
    const book = getBookByUuid(db, req.koboUserId, req.params.uuid);
    if (!book) return res.status(404).end();
    res.json([getMetadata(baseUrl, req.koboToken, book, req.params.uuid)]);
  });

  // GET /download/:bookId/:format  -> the stored book file
  r.get('/download/:bookId/:format', (req, res) => {
    const id = Number(req.params.bookId);
    if (!Number.isInteger(id)) return res.status(404).end();
    const book = db.prepare('SELECT id, format FROM books WHERE id = ? AND user_id = ?').get(id, req.koboUserId);
    if (!book) return res.status(404).end();
    const file = bookPath(dataDir, req.koboUserId, book.id, book.format || 'epub');
    res.type('application/epub+zip').sendFile(path.resolve(file));
  });

  // Cover: /:uuid/:width/:height/:isGreyscale/image.jpg (and the 5-arg quality variant)
  function sendCover(req, res) {
    const book = getBookByUuid(db, req.koboUserId, req.params.uuid);
    if (!book || !book.cover_path) return res.status(404).end();
    res.sendFile(path.resolve(path.join(dataDir, book.cover_path)));
  }
  r.get('/:uuid/:width/:height/:isGreyscale/image.jpg', sendCover);
  r.get('/:uuid/:width/:height/:quality/:isGreyscale/image.jpg', sendCover);

  return r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/routes.kobo.basic.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/kobo.js server/tests/routes.kobo.basic.test.js
git commit -m "feat(kobo): add sync router skeleton (init, download, cover, stubs)"
```

---

## Task 11: `/v1/library/sync` endpoint

**Files:**
- Modify: `server/src/routes/kobo.js`
- Test: `server/tests/routes.kobo.sync.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/routes.kobo.sync.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { createKoboRouter } from '../src/routes/kobo.js';
import { SYNC_TOKEN_HEADER } from '../src/kobo/syncToken.js';

let db, user, token, app;
function addBook(title) {
  return db.prepare("INSERT INTO books (user_id, title, file_path, file_size, format) VALUES (?, ?, 'p', 10, 'epub')").run(user.id, title).lastInsertRowid;
}
beforeEach(() => {
  db = makeDb();
  user = insertUser(db);
  token = createDevice(db, user.id).token;
  app = express();
  app.use(express.json());
  app.use('/kobo/:authToken', createKoboRouter(db, '/tmp'));
});

describe('kobo /v1/library/sync', () => {
  it('first sync returns every book as NewEntitlement and a sync token', async () => {
    addBook('Dune'); addBook('Foundation');
    const res = await request(app).get(`/kobo/${token}/v1/library/sync`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].NewEntitlement.BookMetadata.Title).toBe('Dune');
    expect(res.headers[SYNC_TOKEN_HEADER]).toBeTruthy();
  });

  it('a second sync with the returned token returns nothing new', async () => {
    addBook('Dune');
    const first = await request(app).get(`/kobo/${token}/v1/library/sync`);
    const next = first.headers[SYNC_TOKEN_HEADER];
    const second = await request(app).get(`/kobo/${token}/v1/library/sync`).set(SYNC_TOKEN_HEADER, next);
    expect(second.status).toBe(200);
    expect(second.body).toHaveLength(0);
  });

  it('a book added after the first sync appears as new on the next', async () => {
    addBook('Dune');
    const first = await request(app).get(`/kobo/${token}/v1/library/sync`);
    const next = first.headers[SYNC_TOKEN_HEADER];
    addBook('Hyperion');
    const second = await request(app).get(`/kobo/${token}/v1/library/sync`).set(SYNC_TOKEN_HEADER, next);
    expect(second.body).toHaveLength(1);
    expect(second.body[0].NewEntitlement.BookMetadata.Title).toBe('Hyperion');
  });

  it('only the owner\'s books sync', async () => {
    const other = insertUser(db, { google_sub: 'o', email: 'o@e.com' });
    db.prepare("INSERT INTO books (user_id, title, file_path, format) VALUES (?, 'Secret', 'p', 'epub')").run(other.id);
    addBook('Mine');
    const res = await request(app).get(`/kobo/${token}/v1/library/sync`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].NewEntitlement.BookMetadata.Title).toBe('Mine');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/routes.kobo.sync.test.js`
Expected: FAIL (404 / empty - route not defined).

- [ ] **Step 3: Add the sync endpoint**

In `server/src/routes/kobo.js`, add imports at the top:

```js
import { parseSyncToken, buildSyncToken, SYNC_TOKEN_HEADER } from '../kobo/syncToken.js';
import { toEpoch } from '../kobo/format.js';
import { ensureBookUuid, listSyncBooks } from '../kobo/library.js';
import { createBookEntitlement, getReadingStateResponse } from '../kobo/serializers.js';
```

Note: `getMetadata` is already imported in Task 10. Add a `SYNC_ITEM_LIMIT` constant near the top of `createKoboRouter`:

```js
  const SYNC_ITEM_LIMIT = 100;
```

Then add the route (place it before the cover catch-all routes so it is matched first):

```js
  // GET /v1/library/sync -> changelist of NewEntitlement / ChangedReadingState
  r.get('/v1/library/sync', (req, res) => {
    const userId = req.koboUserId;
    const inTok = parseSyncToken(req.get(SYNC_TOKEN_HEADER));
    const results = [];
    let maxCreated = inTok.books_last_created;
    let maxRs = inTok.reading_state_last_modified;
    let truncated = false;

    for (const book of listSyncBooks(db, userId)) {
      const createdEpoch = toEpoch(book.uploaded_at);
      if (createdEpoch > maxCreated) maxCreated = createdEpoch;
      if (createdEpoch > inTok.books_last_created) {
        if (results.length >= SYNC_ITEM_LIMIT) { truncated = true; break; }
        const uuid = ensureBookUuid(db, book);
        results.push({
          NewEntitlement: {
            BookEntitlement: createBookEntitlement(book, uuid),
            BookMetadata: getMetadata(baseUrl, req.koboToken, book, uuid),
          },
        });
      }
    }

    if (!truncated) {
      const progresses = db.prepare(`
        SELECT rp.*, b.kobo_uuid AS uuid
          FROM reading_progress rp JOIN books b ON b.id = rp.book_id
         WHERE b.user_id = ?
      `).all(userId);
      for (const p of progresses) {
        const epoch = toEpoch(p.last_read_at);
        if (epoch > maxRs) maxRs = epoch;
        if (p.uuid && epoch > inTok.reading_state_last_modified) {
          if (results.length >= SYNC_ITEM_LIMIT) { truncated = true; break; }
          results.push({ ChangedReadingState: { ReadingState: getReadingStateResponse(p.uuid, p) } });
        }
      }
    }

    const outTok = buildSyncToken({
      ...inTok,
      books_last_created: maxCreated,
      books_last_modified: maxCreated,
      reading_state_last_modified: maxRs,
    });
    res.set(SYNC_TOKEN_HEADER, outTok);
    if (truncated) res.set('x-kobo-sync', 'continue');
    res.json(results);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/routes.kobo.sync.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/kobo.js server/tests/routes.kobo.sync.test.js
git commit -m "feat(kobo): implement /v1/library/sync changelist"
```

---

## Task 12: Reading state GET/PUT (progress)

**Files:**
- Modify: `server/src/routes/kobo.js`
- Test: `server/tests/routes.kobo.state.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/routes.kobo.state.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { ensureBookUuid } from '../src/kobo/library.js';
import { createKoboRouter } from '../src/routes/kobo.js';

let db, user, token, app, uuid, bookId;
beforeEach(() => {
  db = makeDb();
  user = insertUser(db);
  token = createDevice(db, user.id).token;
  bookId = db.prepare("INSERT INTO books (user_id, title, file_path, format) VALUES (?, 'Dune', 'p', 'epub')").run(user.id).lastInsertRowid;
  uuid = ensureBookUuid(db, db.prepare('SELECT * FROM books WHERE id = ?').get(bookId));
  app = express();
  app.use(express.json());
  app.use('/kobo/:authToken', createKoboRouter(db, '/tmp'));
});

describe('kobo reading state', () => {
  it('GET returns a one-element ReadingState array', async () => {
    const res = await request(app).get(`/kobo/${token}/v1/library/${uuid}/state`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].EntitlementId).toBe(uuid);
  });

  it('PUT stores progress and GET reflects it', async () => {
    const put = await request(app)
      .put(`/kobo/${token}/v1/library/${uuid}/state`)
      .send({ ReadingStates: [{
        CurrentBookmark: {
          ProgressPercent: 30,
          ContentSourceProgressPercent: 12,
          Location: { Value: 'span#kobo.5.2', Type: 'KoboSpan', Source: 'OEBPS/ch5.xhtml' },
        },
        StatusInfo: { Status: 'Reading' },
        Statistics: { SpentReadingMinutes: 4, RemainingTimeMinutes: 100 },
      }] });
    expect(put.status).toBe(200);
    expect(put.body.RequestResult).toBe('Success');

    const row = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(bookId);
    expect(row.percentage).toBeCloseTo(0.12);
    expect(row.kobo_chapter_progress).toBeCloseTo(0.30);
    expect(row.kobo_location_value).toBe('span#kobo.5.2');
    expect(row.source).toBe('kobo');

    const get = await request(app).get(`/kobo/${token}/v1/library/${uuid}/state`);
    expect(get.body[0].CurrentBookmark.ContentSourceProgressPercent).toBe(12);
  });

  it('PUT with a malformed body is a 400', async () => {
    const res = await request(app).put(`/kobo/${token}/v1/library/${uuid}/state`).send({ nope: true });
    expect(res.status).toBe(400);
  });

  it('PUT to a book the device does not own is 404', async () => {
    const res = await request(app)
      .put(`/kobo/${token}/v1/library/00000000-0000-0000-0000-000000000000/state`)
      .send({ ReadingStates: [{ CurrentBookmark: {} }] });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/routes.kobo.state.test.js`
Expected: FAIL (route not defined).

- [ ] **Step 3: Add the state routes**

In `server/src/routes/kobo.js`, add to the imports from serializers so the line reads:

```js
import { createBookEntitlement, getReadingStateResponse } from '../kobo/serializers.js';
```

(`getReadingStateResponse` was already added in Task 11; `getBookByUuid` and `toKoboTimestamp` are needed - add `import { toKoboTimestamp } from '../kobo/format.js';` if not already importing it, or extend the existing format import to `import { toEpoch, toKoboTimestamp } from '../kobo/format.js';`.)

Add the routes (place before the cover catch-all routes):

```js
  // GET /v1/library/:uuid/state -> [ReadingState]
  r.get('/v1/library/:uuid/state', (req, res) => {
    const book = getBookByUuid(db, req.koboUserId, req.params.uuid);
    if (!book) return res.status(404).end();
    const progress = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(book.id);
    res.json([getReadingStateResponse(req.params.uuid, progress || undefined)]);
  });

  // PUT /v1/library/:uuid/state -> store device progress
  r.put('/v1/library/:uuid/state', (req, res) => {
    const book = getBookByUuid(db, req.koboUserId, req.params.uuid);
    if (!book) return res.status(404).end();
    const rs = req.body && Array.isArray(req.body.ReadingStates) ? req.body.ReadingStates[0] : null;
    if (!rs || typeof rs !== 'object') return res.status(400).json({ error: 'bad_request' });

    const bm = rs.CurrentBookmark || {};
    const chapterProgress = bm.ProgressPercent != null ? bm.ProgressPercent / 100 : null;
    const bookPercent = bm.ContentSourceProgressPercent != null ? bm.ContentSourceProgressPercent / 100 : null;
    const loc = bm.Location || {};
    const locValue = loc.Value ?? null;
    const locSource = loc.Source ?? null;

    const existing = db.prepare('SELECT book_id FROM reading_progress WHERE book_id = ?').get(book.id);
    if (existing) {
      db.prepare(`
        UPDATE reading_progress SET
          percentage = COALESCE(?, percentage),
          kobo_chapter_progress = COALESCE(?, kobo_chapter_progress),
          kobo_chapter_id = COALESCE(?, kobo_chapter_id),
          kobo_location_value = COALESCE(?, kobo_location_value),
          source = 'kobo',
          last_read_at = CURRENT_TIMESTAMP
        WHERE book_id = ?
      `).run(bookPercent, chapterProgress, locSource, locValue, book.id);
    } else {
      db.prepare(`
        INSERT INTO reading_progress
          (book_id, cfi, percentage, kobo_chapter_progress, kobo_chapter_id, kobo_location_value, source, last_read_at)
        VALUES (?, NULL, COALESCE(?, 0), ?, ?, ?, 'kobo', CURRENT_TIMESTAMP)
      `).run(book.id, bookPercent, chapterProgress, locSource, locValue);
    }

    const now = toKoboTimestamp(new Date());
    res.json({
      RequestResult: 'Success',
      UpdateResults: [{
        EntitlementId: req.params.uuid,
        CurrentBookmarkResult: { Result: 'Success' },
        StatusInfoResult: { Result: 'Success' },
        StatisticsResult: { Result: 'Success' },
        LastModified: now,
        PriorityTimestamp: now,
      }],
    });
  });
```

Also add the `getBookByUuid` import if Task 10 did not already include it (it did). Confirm the top of the file imports `getBookByUuid` from `../kobo/library.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/routes.kobo.state.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/kobo.js server/tests/routes.kobo.state.test.js
git commit -m "feat(kobo): implement reading-state GET/PUT progress sync"
```

---

## Task 13: Wire routers into the app

**Files:**
- Modify: `server/src/app.js`
- Test: `server/tests/routes.kobo.wired.test.js`

- [ ] **Step 1: Write the failing test**

```js
// server/tests/routes.kobo.wired.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeDb, insertUser, authHeader } from './helpers.js';

let tmp, db, app, user;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'er-'));
  db = makeDb();
  user = insertUser(db);
  app = createApp({ db, dataDir: tmp });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('kobo wired into app', () => {
  it('device API and kobo sync are reachable through createApp', async () => {
    const created = await request(app).post('/api/devices').set(authHeader(user)).send({ name: 'Libra' });
    expect(created.status).toBe(200);
    const token = created.body.token;
    const sync = await request(app).get(`/kobo/${token}/v1/library/sync`);
    expect(sync.status).toBe(200);
    expect(Array.isArray(sync.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/routes.kobo.wired.test.js`
Expected: FAIL (404 on /api/devices).

- [ ] **Step 3: Wire the routers**

In `server/src/app.js`, add imports near the other route imports:

```js
import { createDevicesRouter } from './routes/devices.js';
import { createKoboRouter } from './routes/kobo.js';
```

Mount them. Add the devices router with the other `/api` routers (after `createGroupsRouter`):

```js
  app.use('/api/devices', createDevicesRouter(db));
```

Mount the Kobo router BEFORE the production SPA static/catch-all block (so `app.get('*')` does not swallow `/kobo/...`). Add it right after the `/downloads` static block:

```js
  // Kobo device sync protocol (path-token auth, no Google JWT).
  app.use('/kobo/:authToken', createKoboRouter(db, dataDir));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/routes.kobo.wired.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Run the whole suite**

Run: `cd server && npx vitest run`
Expected: PASS (all existing + new tests green).

- [ ] **Step 6: Commit**

```bash
git add server/src/app.js server/tests/routes.kobo.wired.test.js
git commit -m "feat(kobo): wire device + sync routers into the app"
```

---

## Task 14: Minimal Devices UI (client)

**Files:**
- Create: `client/src/devices/DevicesPanel.jsx`
- Modify: wherever the app renders settings/library navigation (follow the existing client structure under `client/src/`; add a route/link to the panel).

This task is intentionally small: it only needs to let the user create a device and copy the `api_endpoint=` line. Match the existing client's data-fetching pattern (inspect `client/src/library/` and `client/src/lib/` for the API helper used elsewhere; reuse it rather than introducing `fetch` directly if a helper exists).

- [ ] **Step 1: Read the client conventions**

Run: `ls client/src/lib client/src/library && sed -n '1,40p' client/src/lib/*.js 2>/dev/null`
Expected: identifies the API helper (e.g. an `api.js` with auth header injection) and how panels are structured.

- [ ] **Step 2: Implement the panel**

Create `client/src/devices/DevicesPanel.jsx` that:
- on mount, GETs `/api/devices` and lists them (name, last seen, the `apiEndpoint`);
- has a "Add Kobo" button that POSTs `/api/devices` with a name and shows the returned `apiEndpoint` with a copy button and the instruction text: "On your Kobo, edit `.kobo/Kobo/Kobo eReader.conf`, set `api_endpoint=<value>` under `[OneStoreServices]`, then Sync.";
- has a delete button per device that DELETEs `/api/devices/:id`.

Use the same auth-token mechanism the other panels use (the JWT in the `Authorization` header via the shared API helper). Do not hand-roll a second auth path.

- [ ] **Step 3: Add a link/route to the panel**

Wire a navigation entry to `DevicesPanel` following the existing routing in the client (mirror how `groups` or `library` is linked).

- [ ] **Step 4: Build the client to verify it compiles**

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/src/devices/DevicesPanel.jsx client/src
git commit -m "feat(kobo): add minimal device management UI"
```

---

## Task 15: Manual device validation (real Kobo Libra Colour)

This is hardware integration; it cannot be unit-tested. Do it on the real device after deploying the branch to the server (remember: backend restart requires Jose per `OPS.md`). Record results inline by checking the boxes.

**Pre-req:** server deployed and reachable at `https://mislibros.openlinks.app` over HTTPS, with nginx buffer sizes raised for `/kobo/` (add to the nginx site, then reload):

```nginx
location /kobo/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffer_size 32k;
    proxy_buffers 4 32k;
    proxy_busy_buffers_size 64k;
}
```

- [ ] **Step 1:** In the web app, create a Kobo device and copy the `api_endpoint=` line.
- [ ] **Step 2:** Plug the Libra Colour into a computer. Back up `.kobo/Kobo/Kobo eReader.conf`. Under `[OneStoreServices]` set `api_endpoint=https://mislibros.openlinks.app/kobo/<token>`. Eject.
- [ ] **Step 3:** On the device, tap **Sync**. Confirm the library books appear with covers and metadata.
- [ ] **Step 4:** Open a book, read a few pages, Sync again. Confirm `reading_progress` for that book now has `source='kobo'` and a non-null `kobo_chapter_progress` (query the DB).
- [ ] **Step 5:** If covers fail to load or sync errors, capture the server logs for `/kobo/...` requests. The most likely fixes: add missing keys to `koboResources` (Task 8) or correct the cover route. Note findings here and open follow-up tasks.
- [ ] **Step 6:** Restore official sync to verify reversibility: set `api_endpoint=https://storeapi.kobo.com` back, Sync, confirm store still works. Then re-point at our server.

**Note:** if `Sync` does nothing or errors immediately, check the device firmware version (**Settings -> Device information**). The sync protocol itself is firmware-independent, but capture the version here for sub-project B (NickelMenu needs <= 4.31).

---

## Done criteria for Sub-project A

- All new vitest suites green; existing suite still green (`cd server && npx vitest run`).
- A real Kobo Libra Colour, pointed at the server, shows the user's library and round-trips reading progress (Task 15).
- The web app can mint/list/delete device tokens and show the `api_endpoint=` line.

Sub-project B (highlights/notes + on-device agent + kepubify + exact CFI mapping) is planned separately, after firmware is confirmed.
