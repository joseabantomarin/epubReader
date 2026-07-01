# Visitor Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every HTML page load of the web app into a `visits` table (timestamp, IP, geoip-lite location, OS) via server middleware.

**Architecture:** An Express middleware runs before routing. For requests that are HTML document loads (not assets/API), it resolves the client IP (`req.ip`, already real behind nginx via `trust proxy`), looks up location with the offline `geoip-lite` DB, parses the OS from the User-Agent, and inserts one row into `visits`. Pure helpers (`geo.js`) are isolated from the middleware. No client changes.

**Tech Stack:** Node ESM, Express, better-sqlite3 (WAL), `geoip-lite`, vitest + supertest.

## Global Constraints

- ESM syntax (`import`/`export`), matching the existing codebase.
- Timestamps stored in **UTC** via SQLite `datetime('now')`.
- Tracking must **never** break a request: the middleware body is wrapped in `try/catch` and always calls `next()`.
- **No client changes.**
- Spec: [docs/superpowers/specs/2026-07-01-visitor-tracking-design.md](../specs/2026-07-01-visitor-tracking-design.md).
- Server tests run with `cd server && npm test` (vitest). Single file: `cd server && npx vitest run tests/<file>`.
- After deploy this needs `npm install` on the server and a backend restart (`sudo systemctl restart epubreader.service`) — noted for the deploy step, not part of the code tasks.

---

### Task 1: `visits` table

**Files:**
- Modify: `server/src/db.js` (SCHEMA string, before the closing backtick at line ~94)
- Test: `server/tests/db.visits.test.js`

**Interfaces:**
- Produces: table `visits(id, created_at, ip, country, region, city, os, path, user_agent)`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/db.visits.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { makeDb } from './helpers.js';

describe('visits table', () => {
  it('exists and accepts a row with a default timestamp', () => {
    const db = makeDb();
    const info = db.prepare(
      `INSERT INTO visits (ip, country, region, city, os, path, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('1.2.3.4', 'PE', 'LIM', 'Lima', 'Windows', '/', 'UA');
    expect(Number(info.lastInsertRowid)).toBeGreaterThan(0);
    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(info.lastInsertRowid);
    expect(row).toMatchObject({ ip: '1.2.3.4', country: 'PE', os: 'Windows', path: '/' });
    expect(typeof row.created_at).toBe('string');
    expect(row.created_at.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/db.visits.test.js`
Expected: FAIL — `no such table: visits`.

- [ ] **Step 3: Add the table to the schema**

In `server/src/db.js`, inside the `SCHEMA` template string, immediately after the `kobo_devices` indexes and before the closing `` ` `` (line ~93), add:

```sql
CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ip          TEXT,
  country     TEXT,
  region      TEXT,
  city        TEXT,
  os          TEXT,
  path        TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/db.visits.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.js server/tests/db.visits.test.js
git commit -m "feat(db): add visits table for visitor tracking"
```

---

### Task 2: `geo.js` — location, OS and bot helpers

**Files:**
- Create: `server/src/geo.js`
- Modify: `server/package.json` (add `geoip-lite` dependency)
- Test: `server/tests/geo.test.js`

**Interfaces:**
- Produces:
  - `lookupLocation(ip: string|null) → { country: string|null, region: string|null, city: string|null }`
  - `parseOS(userAgent: string|null|undefined) → string` (one of `Windows`, `macOS`, `Android`, `iOS`, `Chrome OS`, `Linux`, `Other`)
  - `isBot(userAgent: string|null|undefined) → boolean`

- [ ] **Step 1: Install the dependency**

Run (from repo root, installs into the server workspace):

```bash
npm install geoip-lite --workspace=server
```

`geoip-lite` bundles an offline GeoIP dataset, so no external calls are needed at runtime.

- [ ] **Step 2: Write the failing test**

Create `server/tests/geo.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseOS, isBot, lookupLocation } from '../src/geo.js';

describe('parseOS', () => {
  it('detects Windows', () => {
    expect(parseOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });
  it('detects Android before Linux', () => {
    expect(parseOS('Mozilla/5.0 (Linux; Android 13; Pixel 7)')).toBe('Android');
  });
  it('detects iOS', () => {
    expect(parseOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iOS');
  });
  it('detects macOS', () => {
    expect(parseOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS');
  });
  it('detects Linux', () => {
    expect(parseOS('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
  });
  it('returns Other for unknown or empty', () => {
    expect(parseOS('curl/8.0')).toBe('Other');
    expect(parseOS(undefined)).toBe('Other');
  });
});

describe('isBot', () => {
  it('flags crawlers', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
  });
  it('does not flag a normal browser or empty UA', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe(false);
    expect(isBot(undefined)).toBe(false);
  });
});

describe('lookupLocation', () => {
  it('returns null fields for a loopback IP', () => {
    expect(lookupLocation('127.0.0.1')).toEqual({ country: null, region: null, city: null });
  });
  it('never throws on bad input', () => {
    expect(lookupLocation(null)).toEqual({ country: null, region: null, city: null });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run tests/geo.test.js`
Expected: FAIL — cannot find module `../src/geo.js`.

- [ ] **Step 4: Implement `geo.js`**

Create `server/src/geo.js`:

```js
import geoip from 'geoip-lite';

// Resolve an IP to a coarse location using the offline geoip-lite database.
// Returns null fields for private/loopback/unknown IPs (geoip.lookup → null).
export function lookupLocation(ip) {
  try {
    const g = ip ? geoip.lookup(ip) : null;
    if (!g) return { country: null, region: null, city: null };
    return {
      country: g.country || null,
      region: g.region || null,
      city: g.city || null,
    };
  } catch {
    return { country: null, region: null, city: null };
  }
}

// Coarse OS name from a User-Agent string. Order matters: Android and iOS UAs
// also contain "Linux"/"Mac OS X", so they must be checked first.
export function parseOS(ua) {
  if (!ua || typeof ua !== 'string') return 'Other';
  if (/windows/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/cros/i.test(ua)) return 'Chrome OS';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

// Obvious crawler User-Agents, skipped so they don't inflate the table.
export function isBot(ua) {
  return !!ua && /bot|crawl|spider|slurp/i.test(ua);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run tests/geo.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/geo.js server/tests/geo.test.js server/package.json package-lock.json
git commit -m "feat(geo): add geoip-lite location, OS and bot helpers"
```

---

### Task 3: `visitTracker` middleware

**Files:**
- Create: `server/src/middleware/visitTracker.js`
- Test: `server/tests/visitTracker.test.js`

**Interfaces:**
- Consumes: `lookupLocation`, `parseOS`, `isBot` from `../geo.js`; the `visits` table from Task 1.
- Produces:
  - `isPageLoad(req) → boolean`
  - `createVisitTracker(db) → (req, res, next) => void`

- [ ] **Step 1: Write the failing test**

Create `server/tests/visitTracker.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isPageLoad, createVisitTracker } from '../src/middleware/visitTracker.js';
import { makeDb } from './helpers.js';

function fakeReq({ method = 'GET', path = '/', ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', ip = '1.2.3.4' } = {}) {
  return { method, path, ip, headers: { 'user-agent': ua } };
}
function run(mw, req) {
  let called = false;
  mw(req, {}, () => { called = true; });
  return called;
}

describe('isPageLoad', () => {
  it('counts the root, SPA routes and .html pages', () => {
    expect(isPageLoad(fakeReq({ path: '/' }))).toBe(true);
    expect(isPageLoad(fakeReq({ path: '/grupos' }))).toBe(true);
    expect(isPageLoad(fakeReq({ path: '/read/123' }))).toBe(true);
    expect(isPageLoad(fakeReq({ path: '/privacy.html' }))).toBe(true);
  });
  it('ignores assets, api, downloads, kobo and non-GET', () => {
    expect(isPageLoad(fakeReq({ path: '/assets/index-x.js' }))).toBe(false);
    expect(isPageLoad(fakeReq({ path: '/favicon.ico' }))).toBe(false);
    expect(isPageLoad(fakeReq({ path: '/api/books' }))).toBe(false);
    expect(isPageLoad(fakeReq({ path: '/downloads/mislibros.apk' }))).toBe(false);
    expect(isPageLoad(fakeReq({ path: '/kobo/abc' }))).toBe(false);
    expect(isPageLoad(fakeReq({ method: 'POST', path: '/' }))).toBe(false);
  });
});

describe('createVisitTracker', () => {
  it('inserts one row on a page load and calls next', () => {
    const db = makeDb();
    const mw = createVisitTracker(db);
    expect(run(mw, fakeReq({ path: '/', ip: '8.8.8.8' }))).toBe(true);
    const rows = db.prepare('SELECT * FROM visits').all();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ os: 'Windows', path: '/', ip: '8.8.8.8' });
  });
  it('does not insert for assets or api', () => {
    const db = makeDb();
    const mw = createVisitTracker(db);
    run(mw, fakeReq({ path: '/assets/x.js' }));
    run(mw, fakeReq({ path: '/api/health' }));
    expect(db.prepare('SELECT COUNT(*) c FROM visits').get().c).toBe(0);
  });
  it('skips bots', () => {
    const db = makeDb();
    const mw = createVisitTracker(db);
    run(mw, fakeReq({ path: '/', ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' }));
    expect(db.prepare('SELECT COUNT(*) c FROM visits').get().c).toBe(0);
  });
  it('never throws and still calls next if the insert fails', () => {
    const brokenDb = { prepare: () => ({ run: () => { throw new Error('boom'); } }) };
    const mw = createVisitTracker(brokenDb);
    expect(run(mw, fakeReq({ path: '/' }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/visitTracker.test.js`
Expected: FAIL — cannot find module `../src/middleware/visitTracker.js`.

- [ ] **Step 3: Implement the middleware**

Create `server/src/middleware/visitTracker.js`:

```js
import { lookupLocation, parseOS, isBot } from '../geo.js';

const SKIP_PREFIXES = ['/api', '/downloads', '/kobo'];

// A "page load" is a GET for an HTML document: the root, a SPA route, or a
// .html page — never an asset (has a non-.html extension) or an API/download/
// kobo path. Internal SPA navigation does not hit the server, so it is not
// counted; only real document loads/reloads and deep links are.
export function isPageLoad(req) {
  if (req.method !== 'GET') return false;
  const p = req.path || '';
  if (SKIP_PREFIXES.some((pre) => p === pre || p.startsWith(pre + '/'))) return false;
  const last = p.split('/').pop() || '';
  const dot = last.lastIndexOf('.');
  const ext = dot >= 0 ? last.slice(dot).toLowerCase() : '';
  if (ext && ext !== '.html') return false;
  return true;
}

// Express middleware: logs one row per page load. Wrapped in try/catch so
// tracking can never break serving the page.
export function createVisitTracker(db) {
  const insert = db.prepare(
    `INSERT INTO visits (ip, country, region, city, os, path, user_agent)
     VALUES (@ip, @country, @region, @city, @os, @path, @user_agent)`
  );
  return function visitTracker(req, _res, next) {
    try {
      const ua = req.headers['user-agent'] || null;
      if (isPageLoad(req) && !isBot(ua)) {
        const loc = lookupLocation(req.ip);
        insert.run({
          ip: req.ip || null,
          country: loc.country,
          region: loc.region,
          city: loc.city,
          os: parseOS(ua),
          path: req.path || null,
          user_agent: ua,
        });
      }
    } catch {
      // tracking must never break the request
    }
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/visitTracker.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/visitTracker.js server/tests/visitTracker.test.js
git commit -m "feat(middleware): add visitTracker for page-load logging"
```

---

### Task 4: Wire the middleware into the app

**Files:**
- Modify: `server/src/app.js` (import at top; register after `app.locals.dataDir = dataDir;`, ~line 61)
- Test: `server/tests/routes.visits.test.js`

**Interfaces:**
- Consumes: `createVisitTracker` from `./middleware/visitTracker.js`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes.visits.test.js`:

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeDb } from './helpers.js';

describe('visit tracking wired into the app', () => {
  it('logs a visit for a page load but not for /api', async () => {
    const db = makeDb();
    const app = createApp({ db, dataDir: '/tmp/test-data' });
    await request(app).get('/').set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120');
    await request(app).get('/api/health');
    const rows = db.prepare('SELECT * FROM visits').all();
    expect(rows.length).toBe(1);
    expect(rows[0].path).toBe('/');
    expect(rows[0].os).toBe('Windows');
  });
});
```

Note: in `NODE_ENV=test` the SPA static block is skipped, so `GET /` returns 404 — but the middleware runs before routing, so the row is still inserted. That is exactly what we assert.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run tests/routes.visits.test.js`
Expected: FAIL — `rows.length` is 0 (middleware not registered yet).

- [ ] **Step 3: Register the middleware**

In `server/src/app.js`, add the import alongside the other imports (after line 19):

```js
import { createVisitTracker } from './middleware/visitTracker.js';
```

Then, right after `app.locals.dataDir = dataDir;` (line ~61) and before `app.get('/api/health', ...)`, add:

```js
  // Log HTML page loads (not assets/API) for visitor tracking. Runs before
  // routing; self-contained and never throws.
  app.use(createVisitTracker(db));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run tests/routes.visits.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full server suite**

Run: `cd server && npm test`
Expected: all tests pass (existing suite + the 4 new files).

- [ ] **Step 6: Commit**

```bash
git add server/src/app.js server/tests/routes.visits.test.js
git commit -m "feat(app): register visitTracker middleware"
```

---

## Deploy (after all tasks pass)

Not a code task — do this when the user asks to deploy:

1. `git push origin main`.
2. On the server: `cd ~/epubReader && git pull && npm install && cd client && npm run build`. The `npm install` is required so `geoip-lite` is present.
3. **Restart the backend** so the migration runs and the middleware loads: `sudo systemctl restart epubreader.service` (only the server owner can do this).
4. Verify: after some traffic, `SELECT COUNT(*) FROM visits;` in the server DB returns rows.

## Self-Review

- **Spec coverage:** table `visits` with all fields (Task 1) ✓; middleware capture of page loads (Tasks 3–4) ✓; `geoip-lite` offline location (Task 2) ✓; OS parse (Task 2) ✓; bot filter (Task 2–3) ✓; one row per load + SPA/prod caveats (Task 3 `isPageLoad` + comments) ✓; no client changes ✓; deploy + restart note ✓.
- **Placeholder scan:** none — every step has complete code and exact commands.
- **Type consistency:** `lookupLocation`/`parseOS`/`isBot` signatures and the `visits` column names match across Tasks 1–4; the middleware's INSERT columns match the table definition exactly.
