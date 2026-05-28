# epubReader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted online EPUB reader with Google login that syncs reading position across devices.

**Architecture:** Monorepo with `server/` (Node + Express + SQLite + local file storage) and `client/` (React + Vite + epub.js). Google Identity Services issues an id_token; the server verifies it and returns its own HS256 JWT. EPUBs live in `data/books/<userId>/<bookId>.epub`; metadata and reading position in SQLite. In production Express serves the built client and the API on a single port.

**Tech Stack:**
- Server: Node ≥ 20, Express 4, better-sqlite3, google-auth-library, jsonwebtoken, multer, adm-zip, helmet, cors, express-rate-limit, morgan, dotenv
- Server tests: vitest, supertest
- Client: React 18, Vite 5, react-router-dom 6, epubjs
- Client tests: vitest, @testing-library/react

**Reference spec:** [docs/superpowers/specs/2026-05-27-epub-reader-design.md](../specs/2026-05-27-epub-reader-design.md)

---

## File Structure (final state)

```
epubReader/
├── .gitignore
├── package.json                  # npm workspaces root
├── README.md
│
├── server/
│   ├── package.json
│   ├── vitest.config.js
│   ├── .env.example
│   ├── src/
│   │   ├── index.js              # entry: bootstraps Express
│   │   ├── app.js                # Express app factory (export for tests)
│   │   ├── config.js             # env loading + defaults
│   │   ├── db.js                 # SQLite connection + migrations
│   │   ├── auth.js               # google verify + jwt sign/verify
│   │   ├── middleware/
│   │   │   └── authRequired.js
│   │   ├── epub/
│   │   │   └── parser.js         # extract title/author/cover from .epub
│   │   ├── storage.js            # file path helpers, mkdir, delete
│   │   └── routes/
│   │       ├── auth.js
│   │       ├── books.js
│   │       └── progress.js
│   └── tests/
│       ├── fixtures/
│       │   └── sample.epub       # tiny valid EPUB for tests (committed)
│       ├── helpers.js            # makeApp, makeUser, makeToken
│       ├── auth.test.js
│       ├── books.test.js
│       ├── progress.test.js
│       └── parser.test.js
│
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── .env.example
    └── src/
        ├── main.jsx
        ├── App.jsx               # router + AuthProvider
        ├── styles.css            # global tokens + reset
        ├── lib/
        │   ├── api.js            # fetch wrapper
        │   ├── format.js         # relativeTime, etc.
        │   └── format.test.js
        ├── auth/
        │   ├── AuthContext.jsx
        │   ├── ProtectedRoute.jsx
        │   └── LoginPage.jsx
        ├── library/
        │   ├── LibraryPage.jsx
        │   ├── Toolbar.jsx
        │   ├── BookGrid.jsx
        │   ├── BookCard.jsx
        │   └── library.module.css
        └── reader/
            ├── ReaderPage.jsx
            └── reader.module.css
```

---

## Phase 0 — Repository scaffold

### Task 0.1: Initialize git and root files

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `README.md`

- [ ] **Step 1: Init git**

```bash
cd /Users/joseabanto/Applications/epubReader
git init -b main
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
.env
.env.local
server/data/library.db
server/data/library.db-journal
server/data/books/
.DS_Store
*.log
coverage/
```

- [ ] **Step 3: Write `package.json` (workspaces root)**

```json
{
  "name": "epub-reader",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["server", "client"],
  "scripts": {
    "dev:server": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    "build:client": "npm run build -w client",
    "start": "npm run start -w server",
    "test": "npm test --workspaces --if-present"
  }
}
```

- [ ] **Step 4: Write `README.md`**

```markdown
# epubReader

Self-hosted online EPUB reader with Google login and cross-device reading-position sync.

## Quick start (dev)

1. `npm install` at the repo root.
2. Copy `server/.env.example` to `server/.env` and fill in `JWT_SECRET` and `GOOGLE_CLIENT_ID`.
3. Copy `client/.env.example` to `client/.env` and fill in `VITE_GOOGLE_CLIENT_ID`.
4. In one terminal: `npm run dev:server`.
5. In another terminal: `npm run dev:client`.
6. Open the URL Vite prints.

## Production

1. `npm run build:client`
2. `NODE_ENV=production npm start` — Express serves the built client and the API on `PORT`.

See `docs/superpowers/specs/` for the design and `docs/superpowers/plans/` for the implementation plan.
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json README.md docs/
git commit -m "chore: initialize repository with workspaces and design docs"
```

---

### Task 0.2: Scaffold `server/` package

**Files:**
- Create: `server/package.json`
- Create: `server/.env.example`
- Create: `server/vitest.config.js`
- Create: `server/src/config.js`
- Create: `server/src/index.js`
- Create: `server/src/app.js`

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "@epub-reader/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "adm-zip": "^0.5.16",
    "better-sqlite3": "^11.3.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "express-rate-limit": "^7.4.0",
    "google-auth-library": "^9.14.0",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "morgan": "^1.10.0",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `server/.env.example`**

```
PORT=3001
JWT_SECRET=replace-me-with-a-long-random-string-min-32-bytes
GOOGLE_CLIENT_ID=replace-with-your-google-oauth-web-client-id.apps.googleusercontent.com
DATA_DIR=./data
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173
MAX_UPLOAD_MB=50
```

- [ ] **Step 3: Write `server/vitest.config.js`**

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.js'],
    pool: 'forks',
  },
});
```

- [ ] **Step 4: Write `server/src/config.js`**

```javascript
import 'dotenv/config';
import path from 'node:path';

const required = (name) => {
  const v = process.env[name];
  if (!v || v.startsWith('replace-')) {
    throw new Error(`Missing required env var ${name}`);
  }
  return v;
};

export const config = {
  port: Number(process.env.PORT || 3001),
  jwtSecret: process.env.NODE_ENV === 'test' ? 'test-secret-not-for-prod' : required('JWT_SECRET'),
  googleClientId: process.env.NODE_ENV === 'test' ? 'test-google-client-id' : required('GOOGLE_CLIENT_ID'),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
};
```

- [ ] **Step 5: Write minimal `server/src/app.js`**

```javascript
import express from 'express';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  return app;
}
```

- [ ] **Step 6: Write `server/src/index.js`**

```javascript
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`server listening on http://localhost:${config.port}`);
});
```

- [ ] **Step 7: Install deps and smoke-test**

Run:
```bash
npm install
NODE_ENV=test node server/src/index.js &
sleep 1
curl -s http://localhost:3001/api/health
kill %1
```
Expected: `{"ok":true}`

- [ ] **Step 8: Commit**

```bash
git add server/ package-lock.json
git commit -m "chore(server): scaffold Express app with config and health endpoint"
```

---

### Task 0.3: Scaffold `client/` package

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Create: `client/index.html`
- Create: `client/.env.example`
- Create: `client/src/main.jsx`
- Create: `client/src/App.jsx`
- Create: `client/src/styles.css`

- [ ] **Step 1: Write `client/package.json`**

```json
{
  "name": "@epub-reader/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "epubjs": "^0.3.93",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `client/vite.config.js`**

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
  },
});
```

- [ ] **Step 3: Write `client/index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>epubReader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `client/.env.example`**

```
VITE_GOOGLE_CLIENT_ID=replace-with-your-google-oauth-web-client-id.apps.googleusercontent.com
VITE_API_BASE=
```

- [ ] **Step 5: Write `client/src/main.jsx`**

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: Write minimal `client/src/App.jsx`**

```jsx
export default function App() {
  return <h1>epubReader</h1>;
}
```

- [ ] **Step 7: Write base `client/src/styles.css`**

```css
:root {
  --bg: #fafaf7;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
  --accent: #2563eb;
  --card: #ffffff;
  --border: #e5e5e0;
  --shadow: 0 1px 2px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.04);
  --radius: 10px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14141a;
    --fg: #f0f0f0;
    --muted: #9a9aa3;
    --card: #1d1d24;
    --border: #2a2a33;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 4px 12px rgba(0,0,0,.25);
  }
}
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--fg); }
button { font: inherit; }
```

- [ ] **Step 8: Smoke-test the build**

Run:
```bash
npm run build:client
```
Expected: `dist/` produced under `client/`, no errors.

- [ ] **Step 9: Commit**

```bash
git add client/ package-lock.json
git commit -m "chore(client): scaffold Vite + React app"
```

---

## Phase 1 — Backend: DB + Auth foundation

### Task 1.1: SQLite module with migrations

**Files:**
- Create: `server/src/db.js`
- Create: `server/tests/helpers.js`
- Create: `server/tests/db.test.js`

- [ ] **Step 1: Write failing test `server/tests/db.test.js`**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db.js';

describe('db.openDb', () => {
  let db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('creates the schema with users, books, reading_progress tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map(t => t.name);
    expect(names).toContain('users');
    expect(names).toContain('books');
    expect(names).toContain('reading_progress');
  });

  it('enforces foreign keys (cascade on user delete)', () => {
    const userId = db.prepare('INSERT INTO users (google_sub, email) VALUES (?, ?)').run('s1', 'a@b.com').lastInsertRowid;
    db.prepare('INSERT INTO books (user_id, title, file_path) VALUES (?, ?, ?)').run(userId, 'T', 'p');
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM books').get();
    expect(remaining.c).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- db.test`
Expected: FAIL (`openDb` not exported).

- [ ] **Step 3: Implement `server/src/db.js`**

```javascript
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub    TEXT    UNIQUE NOT NULL,
  email         TEXT    NOT NULL,
  name          TEXT,
  picture_url   TEXT,
  created_at    TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS books (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  author        TEXT,
  cover_path    TEXT,
  file_path     TEXT    NOT NULL,
  file_size     INTEGER,
  uploaded_at   TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_books_user ON books(user_id);

CREATE TABLE IF NOT EXISTS reading_progress (
  book_id       INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  cfi           TEXT,
  percentage    REAL    DEFAULT 0,
  last_read_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);
`;

export function openDb(filePath) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w server -- db.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.js server/tests/db.test.js
git commit -m "feat(server): sqlite schema with users, books, reading_progress"
```

---

### Task 1.2: Auth helpers (JWT sign/verify)

**Files:**
- Create: `server/src/auth.js`
- Create: `server/tests/auth.test.js`

- [ ] **Step 1: Write failing test `server/tests/auth.test.js`**

```javascript
import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../src/auth.js';

process.env.NODE_ENV = 'test';

describe('jwt helpers', () => {
  it('signs and verifies a payload round-trip', () => {
    const token = signJwt({ sub: 42, email: 'x@y.com' });
    expect(typeof token).toBe('string');
    const decoded = verifyJwt(token);
    expect(decoded.sub).toBe(42);
    expect(decoded.email).toBe('x@y.com');
  });

  it('rejects a tampered token', () => {
    const token = signJwt({ sub: 1 });
    expect(() => verifyJwt(token + 'x')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- auth.test`
Expected: FAIL (module not found / functions not exported).

- [ ] **Step 3: Implement `server/src/auth.js`**

```javascript
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';

const JWT_EXPIRES_IN = '30d';

export function signJwt(payload) {
  return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });
}

export function verifyJwt(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

const googleClient = new OAuth2Client(config.googleClientId);

export async function verifyGoogleIdToken(credential) {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid Google token payload');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || null,
    picture: payload.picture || null,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w server -- auth.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth.js server/tests/auth.test.js
git commit -m "feat(server): jwt helpers and google id_token verifier"
```

---

### Task 1.3: `authRequired` middleware

**Files:**
- Create: `server/src/middleware/authRequired.js`
- Create: `server/tests/middleware.test.js`

- [ ] **Step 1: Write failing test `server/tests/middleware.test.js`**

```javascript
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authRequired } from '../src/middleware/authRequired.js';
import { signJwt } from '../src/auth.js';

process.env.NODE_ENV = 'test';

function makeApp() {
  const app = express();
  app.get('/protected', authRequired, (req, res) => res.json({ user: req.user }));
  return app;
}

describe('authRequired', () => {
  it('rejects requests with no Authorization header (401)', async () => {
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token (401)', async () => {
    const res = await request(makeApp()).get('/protected').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('attaches req.user when token is valid', async () => {
    const token = signJwt({ sub: 7, email: 'u@e.com' });
    const res = await request(makeApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.sub).toBe(7);
    expect(res.body.user.email).toBe('u@e.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- middleware.test`
Expected: FAIL.

- [ ] **Step 3: Implement `server/src/middleware/authRequired.js`**

```javascript
import { verifyJwt } from '../auth.js';

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    const payload = verifyJwt(match[1]);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w server -- middleware.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/ server/tests/middleware.test.js
git commit -m "feat(server): authRequired middleware verifying JWT"
```

---

### Task 1.4: Test helpers (factory for app + users + tokens)

**Files:**
- Create: `server/tests/helpers.js`

- [ ] **Step 1: Write `server/tests/helpers.js`**

This is a non-TDD utility file; tests in later tasks will exercise it.

```javascript
import express from 'express';
import { openDb } from '../src/db.js';
import { signJwt } from '../src/auth.js';

process.env.NODE_ENV = 'test';

export function makeDb() {
  return openDb(':memory:');
}

export function insertUser(db, overrides = {}) {
  const u = {
    google_sub: 'sub-' + Math.random().toString(36).slice(2),
    email: 'user@example.com',
    name: 'Test User',
    picture_url: null,
    ...overrides,
  };
  const id = db.prepare(
    'INSERT INTO users (google_sub, email, name, picture_url) VALUES (?, ?, ?, ?)'
  ).run(u.google_sub, u.email, u.name, u.picture_url).lastInsertRowid;
  return { id, ...u };
}

export function tokenFor(user) {
  return signJwt({ sub: user.id, email: user.email });
}

export function authHeader(user) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

export function jsonApp() {
  const app = express();
  app.use(express.json());
  return app;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/tests/helpers.js
git commit -m "test(server): add shared test helpers for app/db/users/tokens"
```

---

### Task 1.5: `POST /api/auth/google` route + wire into app

**Files:**
- Create: `server/src/routes/auth.js`
- Modify: `server/src/app.js`
- Create: `server/tests/routes.auth.test.js`

- [ ] **Step 1: Write failing test `server/tests/routes.auth.test.js`**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { makeDb } from './helpers.js';
import { createApp } from '../src/app.js';

process.env.NODE_ENV = 'test';

vi.mock('../src/auth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyGoogleIdToken: vi.fn(),
  };
});
import { verifyGoogleIdToken } from '../src/auth.js';

describe('POST /api/auth/google', () => {
  let app, db;
  beforeEach(() => {
    db = makeDb();
    app = createApp({ db });
    verifyGoogleIdToken.mockReset();
  });

  it('400 when credential is missing', async () => {
    const res = await request(app).post('/api/auth/google').send({});
    expect(res.status).toBe(400);
  });

  it('401 when Google rejects the token', async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(new Error('bad'));
    const res = await request(app).post('/api/auth/google').send({ credential: 'x' });
    expect(res.status).toBe(401);
  });

  it('creates a user on first login and returns a JWT', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({
      sub: 'google-sub-1', email: 'a@b.com', name: 'A', picture: 'http://p',
    });
    const res = await request(app).post('/api/auth/google').send({ credential: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('a@b.com');
    const row = db.prepare('SELECT * FROM users WHERE google_sub = ?').get('google-sub-1');
    expect(row).toBeTruthy();
  });

  it('reuses the existing user on subsequent logins', async () => {
    verifyGoogleIdToken.mockResolvedValue({
      sub: 'google-sub-2', email: 'a@b.com', name: 'A', picture: null,
    });
    await request(app).post('/api/auth/google').send({ credential: 'x' });
    await request(app).post('/api/auth/google').send({ credential: 'x' });
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- routes.auth.test`
Expected: FAIL (`createApp` doesn't accept a `db` option, route missing).

- [ ] **Step 3: Update `server/src/app.js` to accept db + mount routes**

```javascript
import express from 'express';
import { openDb } from './db.js';
import { config } from './config.js';
import path from 'node:path';
import { createAuthRouter } from './routes/auth.js';

export function createApp(options = {}) {
  const db = options.db || openDb(path.join(config.dataDir, 'library.db'));
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.locals.db = db;

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter(db));

  return app;
}
```

- [ ] **Step 4: Implement `server/src/routes/auth.js`**

```javascript
import { Router } from 'express';
import { verifyGoogleIdToken, signJwt } from '../auth.js';

export function createAuthRouter(db) {
  const r = Router();

  r.post('/google', async (req, res) => {
    const { credential } = req.body || {};
    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ error: 'missing_credential' });
    }
    let g;
    try {
      g = await verifyGoogleIdToken(credential);
    } catch {
      return res.status(401).json({ error: 'invalid_google_token' });
    }

    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(g.sub);
    if (!user) {
      const id = db.prepare(
        'INSERT INTO users (google_sub, email, name, picture_url) VALUES (?, ?, ?, ?)'
      ).run(g.sub, g.email, g.name, g.picture).lastInsertRowid;
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    } else {
      db.prepare('UPDATE users SET email = ?, name = ?, picture_url = ? WHERE id = ?')
        .run(g.email, g.name, g.picture, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    const token = signJwt({ sub: user.id, email: user.email });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, picture: user.picture_url },
    });
  });

  return r;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -w server -- routes.auth.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/app.js server/src/routes/auth.js server/tests/routes.auth.test.js
git commit -m "feat(server): POST /api/auth/google exchanges Google id_token for JWT"
```

---

## Phase 2 — Backend: Books + EPUB parsing

### Task 2.1: Storage helpers

**Files:**
- Create: `server/src/storage.js`
- Create: `server/tests/storage.test.js`

- [ ] **Step 1: Write failing test `server/tests/storage.test.js`**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bookPath, coverPath, ensureUserDir, removeBookFiles } from '../src/storage.js';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'er-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('storage helpers', () => {
  it('builds deterministic paths for book and cover', () => {
    expect(bookPath(tmp, 5, 42)).toBe(path.join(tmp, 'books', '5', '42.epub'));
    expect(coverPath(tmp, 5, 42, 'jpg')).toBe(path.join(tmp, 'books', '5', '42.jpg'));
  });

  it('ensureUserDir creates the directory', () => {
    const p = ensureUserDir(tmp, 9);
    expect(fs.existsSync(p)).toBe(true);
    expect(p).toBe(path.join(tmp, 'books', '9'));
  });

  it('removeBookFiles deletes epub and any matching cover', () => {
    const dir = ensureUserDir(tmp, 1);
    fs.writeFileSync(path.join(dir, '7.epub'), 'x');
    fs.writeFileSync(path.join(dir, '7.jpg'), 'x');
    removeBookFiles(tmp, 1, 7);
    expect(fs.existsSync(path.join(dir, '7.epub'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '7.jpg'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- storage.test`
Expected: FAIL.

- [ ] **Step 3: Implement `server/src/storage.js`**

```javascript
import fs from 'node:fs';
import path from 'node:path';

export function bookPath(dataDir, userId, bookId) {
  return path.join(dataDir, 'books', String(userId), `${bookId}.epub`);
}

export function coverPath(dataDir, userId, bookId, ext) {
  return path.join(dataDir, 'books', String(userId), `${bookId}.${ext}`);
}

export function ensureUserDir(dataDir, userId) {
  const p = path.join(dataDir, 'books', String(userId));
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function removeBookFiles(dataDir, userId, bookId) {
  const dir = path.join(dataDir, 'books', String(userId));
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name === `${bookId}.epub` || name.startsWith(`${bookId}.`)) {
      fs.unlinkSync(path.join(dir, name));
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w server -- storage.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/storage.js server/tests/storage.test.js
git commit -m "feat(server): file storage helpers for books and covers"
```

---

### Task 2.2: EPUB parser (title/author/cover)

**Files:**
- Create: `server/src/epub/parser.js`
- Create: `server/tests/fixtures/build-sample-epub.js`
- Create: `server/tests/fixtures/sample.epub` (generated)
- Create: `server/tests/parser.test.js`

- [ ] **Step 1: Write a script to generate a tiny valid EPUB fixture**

Create `server/tests/fixtures/build-sample-epub.js`:

```javascript
// Run with: node server/tests/fixtures/build-sample-epub.js
// Produces server/tests/fixtures/sample.epub
import AdmZip from 'adm-zip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, 'sample.epub');

const zip = new AdmZip();

// mimetype must be the first entry and STORED (epub spec).
zip.addFile('mimetype', Buffer.from('application/epub+zip'), '', 0);

zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`));

zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bid">test-id</dc:identifier>
    <dc:title>Sample Book</dc:title>
    <dc:creator>Jane Doe</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`));

// 1x1 PNG cover
const png = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108020000009077' +
  '53DE0000000C49444154789C6360000000000200013E29C9D40000000049454E44AE426082',
  'hex'
);
zip.addFile('OEBPS/cover.png', png);

zip.addFile('OEBPS/ch1.xhtml', Buffer.from(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head><body><p>Hello.</p></body></html>`));

zip.writeZip(out);
console.log('wrote', out);
```

- [ ] **Step 2: Generate the fixture**

Run: `node server/tests/fixtures/build-sample-epub.js`
Expected: prints `wrote .../sample.epub` and file exists.

- [ ] **Step 3: Write failing test `server/tests/parser.test.js`**

```javascript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEpub } from '../src/epub/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(__dirname, 'fixtures', 'sample.epub');

describe('parseEpub', () => {
  it('extracts title, author, and cover from a valid EPUB', () => {
    const meta = parseEpub(sample);
    expect(meta.title).toBe('Sample Book');
    expect(meta.author).toBe('Jane Doe');
    expect(meta.cover).toBeTruthy();
    expect(meta.cover.ext).toBe('png');
    expect(Buffer.isBuffer(meta.cover.data)).toBe(true);
  });

  it('throws when the file is not a valid zip', () => {
    const bad = path.join(__dirname, 'fixtures', 'bad.txt');
    fs.writeFileSync(bad, 'not a zip');
    expect(() => parseEpub(bad)).toThrow();
    fs.unlinkSync(bad);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w server -- parser.test`
Expected: FAIL.

- [ ] **Step 5: Implement `server/src/epub/parser.js`**

```javascript
import AdmZip from 'adm-zip';
import path from 'node:path';

function getText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function findCoverHref(opfXml) {
  const propsMatch = opfXml.match(/<item[^>]+properties=["'][^"']*cover-image[^"']*["'][^>]*>/i);
  if (propsMatch) {
    const href = propsMatch[0].match(/href=["']([^"']+)["']/i);
    if (href) return href[1];
  }
  const metaCover = opfXml.match(/<meta[^>]+name=["']cover["'][^>]+content=["']([^"']+)["']/i);
  if (metaCover) {
    const id = metaCover[1];
    const item = opfXml.match(new RegExp(`<item[^>]+id=["']${id}["'][^>]*>`, 'i'));
    if (item) {
      const href = item[0].match(/href=["']([^"']+)["']/i);
      if (href) return href[1];
    }
  }
  return null;
}

export function parseEpub(filePath) {
  const zip = new AdmZip(filePath);
  const containerEntry = zip.getEntry('META-INF/container.xml');
  if (!containerEntry) throw new Error('not an epub: missing container.xml');
  const containerXml = containerEntry.getData().toString('utf-8');
  const opfHrefMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
  if (!opfHrefMatch) throw new Error('not an epub: missing rootfile path');
  const opfPath = opfHrefMatch[1];

  const opfEntry = zip.getEntry(opfPath);
  if (!opfEntry) throw new Error('not an epub: missing OPF');
  const opfXml = opfEntry.getData().toString('utf-8');

  const title = getText(opfXml, 'dc:title') || getText(opfXml, 'title') || null;
  const author = getText(opfXml, 'dc:creator') || null;

  let cover = null;
  const coverHref = findCoverHref(opfXml);
  if (coverHref) {
    const opfDir = path.posix.dirname(opfPath);
    const coverFullPath = opfDir === '.' ? coverHref : path.posix.join(opfDir, coverHref);
    const coverEntry = zip.getEntry(coverFullPath);
    if (coverEntry) {
      const ext = (path.extname(coverHref).slice(1) || 'jpg').toLowerCase();
      cover = { ext, data: coverEntry.getData() };
    }
  }

  return { title, author, cover };
}
```

- [ ] **Step 6: Run tests**

Run: `npm test -w server -- parser.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/epub/ server/tests/parser.test.js server/tests/fixtures/
git commit -m "feat(server): epub parser extracts title, author, cover"
```

---

### Task 2.3: Books routes (list, upload, delete)

**Files:**
- Create: `server/src/routes/books.js`
- Modify: `server/src/app.js`
- Create: `server/tests/routes.books.test.js`

- [ ] **Step 1: Write failing test `server/tests/routes.books.test.js`**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeDb, insertUser, authHeader } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(__dirname, 'fixtures', 'sample.epub');

let tmp, app, db, user;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'er-'));
  db = makeDb();
  user = insertUser(db);
  app = createApp({ db, dataDir: tmp });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('GET /api/books', () => {
  it('401 without token', async () => {
    expect((await request(app).get('/api/books')).status).toBe(401);
  });
  it('returns empty list initially', async () => {
    const res = await request(app).get('/api/books').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/books (upload)', () => {
  it('rejects non-epub upload (400)', async () => {
    const bad = path.join(tmp, 'bad.txt');
    fs.writeFileSync(bad, 'hello');
    const res = await request(app)
      .post('/api/books')
      .set(authHeader(user))
      .attach('file', bad);
    expect(res.status).toBe(400);
  });

  it('accepts a valid EPUB and returns metadata', async () => {
    const res = await request(app)
      .post('/api/books')
      .set(authHeader(user))
      .attach('file', sample);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Sample Book');
    expect(res.body.author).toBe('Jane Doe');
    expect(res.body.coverUrl).toMatch(/^\/api\/books\/\d+\/cover$/);
    expect(res.body.percentage).toBe(0);

    const stored = path.join(tmp, 'books', String(user.id), `${res.body.id}.epub`);
    expect(fs.existsSync(stored)).toBe(true);
  });

  it('isolates books between users (GET only returns own)', async () => {
    const other = insertUser(db, { google_sub: 'other', email: 'o@e.com' });
    await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const res = await request(app).get('/api/books').set(authHeader(other));
    expect(res.body).toEqual([]);
  });
});

describe('DELETE /api/books', () => {
  it('deletes own books only and removes files', async () => {
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const bookId = up.body.id;
    const epubFile = path.join(tmp, 'books', String(user.id), `${bookId}.epub`);
    expect(fs.existsSync(epubFile)).toBe(true);

    const res = await request(app)
      .delete('/api/books')
      .set(authHeader(user))
      .send({ ids: [bookId] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(fs.existsSync(epubFile)).toBe(false);
  });

  it('refuses to delete books owned by another user', async () => {
    const other = insertUser(db, { google_sub: 'other', email: 'o@e.com' });
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const res = await request(app)
      .delete('/api/books')
      .set(authHeader(other))
      .send({ ids: [up.body.id] });
    expect(res.body.deleted).toBe(0);
    const stillThere = path.join(tmp, 'books', String(user.id), `${up.body.id}.epub`);
    expect(fs.existsSync(stillThere)).toBe(true);
  });
});

describe('GET /api/books/:id/file and /cover', () => {
  it('serves the EPUB to the owner', async () => {
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const res = await request(app).get(`/api/books/${up.body.id}/file`).set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/epub\+zip/);
  });

  it('refuses to serve to a non-owner', async () => {
    const other = insertUser(db, { google_sub: 'other', email: 'o@e.com' });
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const res = await request(app).get(`/api/books/${up.body.id}/file`).set(authHeader(other));
    expect(res.status).toBe(404);
  });

  it('serves the cover to the owner', async () => {
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const res = await request(app).get(`/api/books/${up.body.id}/cover`).set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- routes.books.test`
Expected: FAIL.

- [ ] **Step 3: Modify `server/src/app.js` to accept `dataDir` and mount routes**

```javascript
import express from 'express';
import path from 'node:path';
import { openDb } from './db.js';
import { config } from './config.js';
import { createAuthRouter } from './routes/auth.js';
import { createBooksRouter } from './routes/books.js';

export function createApp(options = {}) {
  const db = options.db || openDb(path.join(config.dataDir, 'library.db'));
  const dataDir = options.dataDir || config.dataDir;

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.locals.db = db;
  app.locals.dataDir = dataDir;

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/books', createBooksRouter(db, dataDir));

  return app;
}
```

- [ ] **Step 4: Implement `server/src/routes/books.js`**

```javascript
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { authRequired } from '../middleware/authRequired.js';
import { parseEpub } from '../epub/parser.js';
import { bookPath, coverPath, ensureUserDir, removeBookFiles } from '../storage.js';
import { config } from '../config.js';

const MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

function isZip(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.equals(MAGIC);
  } catch { return false; }
}

export function createBooksRouter(db, dataDir) {
  const r = Router();
  r.use(authRequired);

  const upload = multer({
    dest: path.join(dataDir, 'tmp'),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  });
  fs.mkdirSync(path.join(dataDir, 'tmp'), { recursive: true });

  r.get('/', (req, res) => {
    const rows = db.prepare(`
      SELECT b.id, b.title, b.author, b.cover_path, b.uploaded_at,
             COALESCE(p.percentage, 0) AS percentage,
             p.last_read_at AS last_read_at
        FROM books b
        LEFT JOIN reading_progress p ON p.book_id = b.id
       WHERE b.user_id = ?
       ORDER BY COALESCE(p.last_read_at, b.uploaded_at) DESC
    `).all(req.user.id);
    res.json(rows.map(row => ({
      id: row.id,
      title: row.title,
      author: row.author,
      coverUrl: row.cover_path ? `/api/books/${row.id}/cover` : null,
      percentage: row.percentage,
      lastReadAt: row.last_read_at,
    })));
  });

  r.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'missing_file' });
    const tmpPath = req.file.path;
    const originalName = req.file.originalname || 'book.epub';

    const cleanup = () => { try { fs.unlinkSync(tmpPath); } catch {} };

    if (!originalName.toLowerCase().endsWith('.epub') || !isZip(tmpPath)) {
      cleanup();
      return res.status(400).json({ error: 'not_an_epub' });
    }

    let meta = { title: null, author: null, cover: null };
    try { meta = parseEpub(tmpPath); } catch { /* keep nulls */ }

    const title = meta.title || originalName.replace(/\.epub$/i, '');
    const stat = fs.statSync(tmpPath);

    ensureUserDir(dataDir, req.user.id);

    const info = db.prepare(`
      INSERT INTO books (user_id, title, author, cover_path, file_path, file_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, title, meta.author, null, 'pending', stat.size);
    const bookId = info.lastInsertRowid;

    const finalEpub = bookPath(dataDir, req.user.id, bookId);
    fs.renameSync(tmpPath, finalEpub);

    let coverRel = null;
    if (meta.cover) {
      const ext = meta.cover.ext === 'jpeg' ? 'jpg' : meta.cover.ext;
      const finalCover = coverPath(dataDir, req.user.id, bookId, ext);
      fs.writeFileSync(finalCover, meta.cover.data);
      coverRel = path.relative(dataDir, finalCover);
    }
    db.prepare('UPDATE books SET file_path = ?, cover_path = ? WHERE id = ?')
      .run(path.relative(dataDir, finalEpub), coverRel, bookId);

    res.json({
      id: bookId,
      title,
      author: meta.author,
      coverUrl: coverRel ? `/api/books/${bookId}/cover` : null,
      percentage: 0,
      lastReadAt: null,
    });
  });

  r.delete('/', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
    if (ids.length === 0) return res.json({ deleted: 0 });

    const placeholders = ids.map(() => '?').join(',');
    const owned = db.prepare(
      `SELECT id FROM books WHERE user_id = ? AND id IN (${placeholders})`
    ).all(req.user.id, ...ids);

    const deleteStmt = db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?');
    let deleted = 0;
    for (const row of owned) {
      const r = deleteStmt.run(row.id, req.user.id);
      if (r.changes > 0) {
        removeBookFiles(dataDir, req.user.id, row.id);
        deleted += 1;
      }
    }
    res.json({ deleted });
  });

  function getOwnedBook(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const row = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!row) { res.status(404).end(); return null; }
    return row;
  }

  r.get('/:id/file', (req, res) => {
    const book = getOwnedBook(req, res);
    if (!book) return;
    const file = bookPath(dataDir, req.user.id, book.id);
    res.type('application/epub+zip').sendFile(file);
  });

  r.get('/:id/cover', (req, res) => {
    const book = getOwnedBook(req, res);
    if (!book) return;
    if (!book.cover_path) return res.status(404).end();
    res.sendFile(path.join(dataDir, book.cover_path));
  });

  return r;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -w server -- routes.books.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/books.js server/src/app.js server/tests/routes.books.test.js
git commit -m "feat(server): books CRUD with upload, download, cover serving"
```

---

## Phase 3 — Backend: Reading progress

### Task 3.1: Progress routes

**Files:**
- Create: `server/src/routes/progress.js`
- Modify: `server/src/app.js`
- Create: `server/tests/routes.progress.test.js`

- [ ] **Step 1: Write failing test `server/tests/routes.progress.test.js`**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeDb, insertUser, authHeader } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(__dirname, 'fixtures', 'sample.epub');

let tmp, app, db, user, bookId;
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'er-'));
  db = makeDb();
  user = insertUser(db);
  app = createApp({ db, dataDir: tmp });
  const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
  bookId = up.body.id;
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('progress endpoints', () => {
  it('GET returns nulls when no progress exists', async () => {
    const res = await request(app).get(`/api/books/${bookId}/progress`).set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cfi: null, percentage: 0, lastReadAt: null });
  });

  it('PUT then GET round-trips the cfi and percentage', async () => {
    const put = await request(app)
      .put(`/api/books/${bookId}/progress`)
      .set(authHeader(user))
      .send({ cfi: 'epubcfi(/6/4!/4/2/2)', percentage: 0.42 });
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);

    const get = await request(app).get(`/api/books/${bookId}/progress`).set(authHeader(user));
    expect(get.body.cfi).toBe('epubcfi(/6/4!/4/2/2)');
    expect(get.body.percentage).toBeCloseTo(0.42);
    expect(get.body.lastReadAt).toBeTruthy();
  });

  it('refuses access to a non-owner', async () => {
    const other = insertUser(db, { google_sub: 'o', email: 'o@e.com' });
    const res = await request(app).get(`/api/books/${bookId}/progress`).set(authHeader(other));
    expect(res.status).toBe(404);
  });

  it('400 when PUT body is malformed', async () => {
    const res = await request(app)
      .put(`/api/books/${bookId}/progress`)
      .set(authHeader(user))
      .send({ cfi: 123, percentage: 'no' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server -- routes.progress.test`
Expected: FAIL.

- [ ] **Step 3: Implement `server/src/routes/progress.js`**

```javascript
import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';

export function createProgressRouter(db) {
  const r = Router({ mergeParams: true });
  r.use(authRequired);

  function ownedBook(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const row = db.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!row) { res.status(404).end(); return null; }
    return row;
  }

  r.get('/:id/progress', (req, res) => {
    const book = ownedBook(req, res);
    if (!book) return;
    const row = db.prepare('SELECT cfi, percentage, last_read_at FROM reading_progress WHERE book_id = ?').get(book.id);
    if (!row) return res.json({ cfi: null, percentage: 0, lastReadAt: null });
    res.json({ cfi: row.cfi, percentage: row.percentage, lastReadAt: row.last_read_at });
  });

  r.put('/:id/progress', (req, res) => {
    const { cfi, percentage } = req.body || {};
    if (typeof cfi !== 'string' || typeof percentage !== 'number' || Number.isNaN(percentage)) {
      return res.status(400).json({ error: 'invalid_body' });
    }
    const book = ownedBook(req, res);
    if (!book) return;
    db.prepare(`
      INSERT INTO reading_progress (book_id, cfi, percentage, last_read_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(book_id) DO UPDATE SET
        cfi = excluded.cfi,
        percentage = excluded.percentage,
        last_read_at = CURRENT_TIMESTAMP
    `).run(book.id, cfi, percentage);
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Wire into `server/src/app.js`**

Replace the `app.use('/api/books', ...)` line so progress shares the books path:

```javascript
import { createProgressRouter } from './routes/progress.js';
// ...
app.use('/api/books', createBooksRouter(db, dataDir));
app.use('/api/books', createProgressRouter(db));
```

- [ ] **Step 5: Run tests**

Run: `npm test -w server -- routes.progress.test`
Expected: PASS.

- [ ] **Step 6: Run the full server suite**

Run: `npm test -w server`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/progress.js server/src/app.js server/tests/routes.progress.test.js
git commit -m "feat(server): GET/PUT reading progress with cfi and percentage"
```

---

## Phase 4 — Backend hardening + serving the client

### Task 4.1: Helmet, CORS, rate limiting, static client

**Files:**
- Modify: `server/src/app.js`

- [ ] **Step 1: Update `server/src/app.js` to add middlewares and static client serving**

```javascript
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { openDb } from './db.js';
import { config } from './config.js';
import { createAuthRouter } from './routes/auth.js';
import { createBooksRouter } from './routes/books.js';
import { createProgressRouter } from './routes/progress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(options = {}) {
  const db = options.db || openDb(path.join(config.dataDir, 'library.db'));
  const dataDir = options.dataDir || config.dataDir;
  const isTest = process.env.NODE_ENV === 'test';
  const isProd = process.env.NODE_ENV === 'production';

  const app = express();
  app.set('trust proxy', 1);

  if (!isTest) {
    app.use(morgan(isProd ? 'combined' : 'dev'));
    app.use(helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
          'frame-src': ["'self'", 'https://accounts.google.com'],
          'connect-src': ["'self'", 'https://accounts.google.com'],
          'img-src': ["'self'", 'data:', 'https:'],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
    }));
    if (!isProd) app.use(cors({ origin: config.clientOrigin }));
  }

  app.use(express.json({ limit: '1mb' }));
  app.locals.db = db;
  app.locals.dataDir = dataDir;

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  if (!isTest) {
    app.use('/api/auth/google', rateLimit({ windowMs: 60_000, max: 10 }));
  }
  app.use('/api/auth', createAuthRouter(db));

  if (!isTest) {
    const uploadLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 30,
      keyGenerator: (req) => req.user?.id ? `u:${req.user.id}` : req.ip,
    });
    app.use((req, res, next) => {
      if (req.method === 'POST' && req.path === '/api/books') return uploadLimiter(req, res, next);
      next();
    });
  }
  app.use('/api/books', createBooksRouter(db, dataDir));
  app.use('/api/books', createProgressRouter(db));

  if (isProd) {
    const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
    }
  }

  app.use((err, _req, res, _next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'file_too_large' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
```

- [ ] **Step 2: Run the full server suite**

Run: `npm test -w server`
Expected: all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/app.js
git commit -m "feat(server): helmet CSP, cors in dev, rate limit, static client in prod"
```

---

## Phase 5 — Frontend: Auth + plumbing

### Task 5.1: API client and format helpers

**Files:**
- Create: `client/src/lib/api.js`
- Create: `client/src/lib/format.js`
- Create: `client/src/lib/format.test.js`

- [ ] **Step 1: Write `client/src/lib/api.js`**

```javascript
const BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'epubreader.token';
const USER_KEY = 'epubreader.user';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
export function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function call(path, { method = 'GET', body, formData, headers = {} } = {}) {
  const token = getToken();
  const finalHeaders = { ...headers };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers: finalHeaders, body: payload });
  if (res.status === 401) {
    clearAuth();
    if (location.pathname !== '/login') location.assign('/login');
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let err = { error: 'request_failed', status: res.status };
    try { err = await res.json(); } catch {}
    throw Object.assign(new Error(err.error || 'request_failed'), { status: res.status, body: err });
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  loginGoogle: (credential) => call('/api/auth/google', { method: 'POST', body: { credential } }),
  listBooks: () => call('/api/books'),
  uploadBook: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return call('/api/books', { method: 'POST', formData: fd });
  },
  deleteBooks: (ids) => call('/api/books', { method: 'DELETE', body: { ids } }),
  getProgress: (bookId) => call(`/api/books/${bookId}/progress`),
  putProgress: (bookId, cfi, percentage) =>
    call(`/api/books/${bookId}/progress`, { method: 'PUT', body: { cfi, percentage } }),
};

export function bookFileUrl(bookId) {
  return `${BASE}/api/books/${bookId}/file`;
}
export function bookCoverUrl(bookId) {
  return `${BASE}/api/books/${bookId}/cover`;
}
```

- [ ] **Step 2: Write failing test `client/src/lib/format.test.js`**

```javascript
import { describe, it, expect } from 'vitest';
import { relativeTime } from './format.js';

describe('relativeTime', () => {
  const now = new Date('2026-05-27T12:00:00Z');
  it('returns "nunca" when value is null/undefined', () => {
    expect(relativeTime(null, now)).toBe('nunca');
    expect(relativeTime(undefined, now)).toBe('nunca');
  });
  it('handles seconds, minutes, hours, days', () => {
    expect(relativeTime('2026-05-27T11:59:30Z', now)).toBe('ahora');
    expect(relativeTime('2026-05-27T11:55:00Z', now)).toBe('hace 5min');
    expect(relativeTime('2026-05-27T10:00:00Z', now)).toBe('hace 2h');
    expect(relativeTime('2026-05-25T12:00:00Z', now)).toBe('hace 2d');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w client -- format.test`
Expected: FAIL.

- [ ] **Step 4: Implement `client/src/lib/format.js`**

```javascript
export function relativeTime(value, now = new Date()) {
  if (!value) return 'nunca';
  const then = new Date(value);
  const diff = Math.max(0, now.getTime() - then.getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'ahora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

export function percent(n) {
  return `${Math.round((n || 0) * 100)}%`;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -w client -- format.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/
git commit -m "feat(client): api wrapper and format helpers"
```

---

### Task 5.2: AuthContext + ProtectedRoute

**Files:**
- Create: `client/src/auth/AuthContext.jsx`
- Create: `client/src/auth/ProtectedRoute.jsx`

- [ ] **Step 1: Write `client/src/auth/AuthContext.jsx`**

```jsx
import { createContext, useContext, useState, useCallback } from 'react';
import { getToken, getUser, setToken, setUser, clearAuth, api } from '../lib/api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => getToken());
  const [user, setUserState] = useState(() => getUser());

  const loginWithGoogle = useCallback(async (credential) => {
    const { token, user } = await api.loginGoogle(credential);
    setToken(token);
    setUser(user);
    setTokenState(token);
    setUserState(user);
    return user;
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setTokenState(null);
    setUserState(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ token, user, loginWithGoogle, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Write `client/src/auth/ProtectedRoute.jsx`**

```jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export function ProtectedRoute({ children }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/auth/AuthContext.jsx client/src/auth/ProtectedRoute.jsx
git commit -m "feat(client): AuthProvider context and ProtectedRoute guard"
```

---

### Task 5.3: LoginPage with Google Identity Services

**Files:**
- Create: `client/src/auth/LoginPage.jsx`
- Create: `client/src/auth/login.module.css`

- [ ] **Step 1: Write `client/src/auth/LoginPage.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import styles from './login.module.css';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = GSI_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const btnRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !btnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async ({ credential }) => {
          try {
            await loginWithGoogle(credential);
            navigate('/', { replace: true });
          } catch (e) {
            setError('No se pudo iniciar sesión. Inténtalo de nuevo.');
          }
        },
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with',
      });
    }).catch(() => setError('No se pudo cargar Google Sign-In.'));
    return () => { cancelled = true; };
  }, [loginWithGoogle, navigate]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>epubReader</h1>
        <p className={styles.sub}>Tus libros, sincronizados donde sea.</p>
        <div ref={btnRef} className={styles.btnSlot} />
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Write `client/src/auth/login.module.css`**

```css
.page {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
}
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 40px 32px;
  box-shadow: var(--shadow);
  text-align: center;
  width: 100%;
  max-width: 380px;
}
.title { font-size: 32px; margin: 0 0 8px; letter-spacing: -0.5px; }
.sub { color: var(--muted); margin: 0 0 28px; }
.btnSlot { display: flex; justify-content: center; }
.error { color: #b00020; margin-top: 16px; font-size: 14px; }
```

- [ ] **Step 3: Commit**

```bash
git add client/src/auth/LoginPage.jsx client/src/auth/login.module.css
git commit -m "feat(client): LoginPage with Google Identity Services button"
```

---

### Task 5.4: Wire router in App.jsx with placeholder Library/Reader pages

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Update `client/src/App.jsx`**

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import { ProtectedRoute } from './auth/ProtectedRoute.jsx';
import LoginPage from './auth/LoginPage.jsx';
import LibraryPage from './library/LibraryPage.jsx';
import ReaderPage from './reader/ReaderPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
          <Route path="/read/:bookId" element={<ProtectedRoute><ReaderPage /></ProtectedRoute>} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

- [ ] **Step 2: Add stub `client/src/library/LibraryPage.jsx`**

```jsx
export default function LibraryPage() {
  return <h1 style={{ padding: 24 }}>epubReader — Library (stub)</h1>;
}
```

- [ ] **Step 3: Add stub `client/src/reader/ReaderPage.jsx`**

```jsx
export default function ReaderPage() {
  return <h1 style={{ padding: 24 }}>Reader (stub)</h1>;
}
```

- [ ] **Step 4: Verify the client still builds**

Run: `npm run build:client`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.jsx client/src/library/LibraryPage.jsx client/src/reader/ReaderPage.jsx
git commit -m "feat(client): router with auth-protected routes and stub pages"
```

---

## Phase 6 — Frontend: Library page

### Task 6.1: BookCard + cover fallback

**Files:**
- Create: `client/src/library/BookCard.jsx`
- Create: `client/src/library/library.module.css` (initial)

- [ ] **Step 1: Write `client/src/library/library.module.css`**

```css
.page {
  min-height: 100dvh;
  padding: 16px;
  max-width: 1280px;
  margin: 0 auto;
}
@media (min-width: 640px) {
  .page { padding: 24px; }
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.title { font-size: 24px; margin: 0; letter-spacing: -0.3px; }
@media (min-width: 640px) { .title { font-size: 28px; } }

.userBox { display: flex; align-items: center; gap: 8px; }
.avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
.logoutBtn {
  background: transparent; border: 1px solid var(--border);
  border-radius: 8px; padding: 6px 10px; cursor: pointer; color: inherit;
}

.toolbar {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-bottom: 20px;
}
@media (min-width: 640px) {
  .toolbar { grid-template-columns: 1fr auto auto; }
}
.search {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: inherit;
}
.toolbarButtons { display: flex; gap: 8px; flex-wrap: wrap; }
.btn {
  background: var(--card); color: inherit;
  border: 1px solid var(--border);
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 500;
}
.btnPrimary { background: var(--accent); color: white; border-color: transparent; }
.btnDanger { background: #b00020; color: white; border-color: transparent; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px;
}
@media (min-width: 640px) {
  .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 20px; }
}

.card {
  display: flex; flex-direction: column; gap: 8px;
  cursor: pointer;
  user-select: none;
  position: relative;
}
.cover {
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  background: var(--border);
  overflow: hidden;
  box-shadow: var(--shadow);
  position: relative;
}
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.coverFallback {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 12px; text-align: center; color: white;
  font-size: 12px;
}
.coverFallback strong { display: block; margin-bottom: 4px; font-size: 14px; }

.cardTitle { font-size: 14px; font-weight: 600; line-height: 1.2; margin: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cardAuthor { font-size: 12px; color: var(--muted); margin: 0; }
.progressBar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.progressFill { height: 100%; background: var(--accent); }
.cardMeta { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }

.checkbox {
  position: absolute;
  top: 8px; left: 8px;
  width: 22px; height: 22px;
  border-radius: 6px;
  background: rgba(255,255,255,.9);
  border: 1px solid var(--border);
  display: grid; place-items: center;
  font-size: 14px;
  color: var(--accent);
}
.selected .cover { outline: 3px solid var(--accent); outline-offset: 2px; }

.empty {
  padding: 48px 24px;
  text-align: center;
  color: var(--muted);
}
.spinner {
  display: inline-block; width: 16px; height: 16px;
  border: 2px solid var(--border); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .8s linear infinite;
  vertical-align: middle; margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 2: Write `client/src/library/BookCard.jsx`**

```jsx
import styles from './library.module.css';
import { bookCoverUrl } from '../lib/api.js';
import { percent, relativeTime } from '../lib/format.js';

function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 50% 45%)`;
}

export default function BookCard({ book, selectionMode, selected, onActivate }) {
  const handleClick = () => onActivate(book);
  return (
    <div
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
    >
      <div className={styles.cover} style={{ background: hashColor(book.title || 'x') }}>
        {book.coverUrl ? (
          <img src={bookCoverUrl(book.id)} alt="" loading="lazy" />
        ) : (
          <div className={styles.coverFallback}>
            <strong>{book.title}</strong>
            {book.author && <span>{book.author}</span>}
          </div>
        )}
        {selectionMode && (
          <div className={styles.checkbox} aria-hidden>{selected ? '✓' : ''}</div>
        )}
      </div>
      <p className={styles.cardTitle}>{book.title}</p>
      <p className={styles.cardAuthor}>{book.author || '—'}</p>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: percent(book.percentage) }} />
      </div>
      <div className={styles.cardMeta}>
        <span>{percent(book.percentage)}</span>
        <span>{relativeTime(book.lastReadAt)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/library/BookCard.jsx client/src/library/library.module.css
git commit -m "feat(client): BookCard with cover, progress, and selection state"
```

---

### Task 6.2: Toolbar (search + add + select/delete toggle)

**Files:**
- Create: `client/src/library/Toolbar.jsx`

- [ ] **Step 1: Write `client/src/library/Toolbar.jsx`**

```jsx
import { useRef } from 'react';
import styles from './library.module.css';

export default function Toolbar({
  query, onQueryChange,
  selectionMode, selectedCount,
  onAddFile,
  onEnterSelection, onCancelSelection, onDeleteSelected,
  uploading,
}) {
  const fileRef = useRef(null);
  return (
    <div className={styles.toolbar}>
      <input
        className={styles.search}
        type="search"
        placeholder="🔍 Buscar por título o autor..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <div className={styles.toolbarButtons}>
        {!selectionMode ? (
          <>
            <button className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => fileRef.current.click()} disabled={uploading}>
              {uploading ? <><span className={styles.spinner} />Subiendo…</> : '＋ Agregar'}
            </button>
            <button className={styles.btn} onClick={onEnterSelection}>☑ Seleccionar</button>
            <input
              ref={fileRef} type="file" accept=".epub"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onAddFile(f);
                e.target.value = '';
              }}
            />
          </>
        ) : (
          <>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={onDeleteSelected}
              disabled={selectedCount === 0}
            >
              🗑 Eliminar ({selectedCount})
            </button>
            <button className={styles.btn} onClick={onCancelSelection}>Cancelar</button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/library/Toolbar.jsx
git commit -m "feat(client): Library toolbar with search, add, and selection toggle"
```

---

### Task 6.3: LibraryPage wiring (list/upload/delete/search/select)

**Files:**
- Modify: `client/src/library/LibraryPage.jsx`

- [ ] **Step 1: Write full `client/src/library/LibraryPage.jsx`**

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './library.module.css';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Toolbar from './Toolbar.jsx';
import BookCard from './BookCard.jsx';

export default function LibraryPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setBooks(await api.listBooks());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter(b =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q)
    );
  }, [books, query]);

  const handleAddFile = async (file) => {
    setUploading(true);
    try {
      const created = await api.uploadBook(file);
      setBooks((prev) => [created, ...prev]);
    } catch (e) {
      alert('No se pudo subir el libro: ' + (e.body?.error || e.message));
    } finally {
      setUploading(false);
    }
  };

  const enterSelection = () => { setSelectionMode(true); setSelectedIds(new Set()); };
  const cancelSelection = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`¿Eliminar ${ids.length} libro(s)? Esta acción no se puede deshacer.`)) return;
    try {
      await api.deleteBooks(ids);
      setBooks((prev) => prev.filter(b => !selectedIds.has(b.id)));
      cancelSelection();
    } catch (e) {
      alert('Error al eliminar: ' + e.message);
    }
  };

  const onActivate = (book) => {
    if (selectionMode) toggleSelect(book.id);
    else navigate(`/read/${book.id}`);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>epubReader</h1>
        <div className={styles.userBox}>
          {user?.picture && <img src={user.picture} alt="" className={styles.avatar} />}
          <button className={styles.logoutBtn} onClick={logout}>Salir</button>
        </div>
      </header>

      <Toolbar
        query={query}
        onQueryChange={setQuery}
        selectionMode={selectionMode}
        selectedCount={selectedIds.size}
        uploading={uploading}
        onAddFile={handleAddFile}
        onEnterSelection={enterSelection}
        onCancelSelection={cancelSelection}
        onDeleteSelected={deleteSelected}
      />

      {error && <p className={styles.empty} style={{ color: '#b00020' }}>{error}</p>}
      {loading ? (
        <p className={styles.empty}><span className={styles.spinner} />Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>
          {books.length === 0
            ? 'Aún no tienes libros. Pulsa "Agregar" para subir tu primer EPUB.'
            : 'No hay coincidencias.'}
        </p>
      ) : (
        <div className={styles.grid}>
          {filtered.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              selectionMode={selectionMode}
              selected={selectedIds.has(b.id)}
              onActivate={onActivate}
            />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Manual smoke test**

Run both dev servers (`npm run dev:server` in one shell, `npm run dev:client` in another) and:
- Open `http://localhost:5173/` — should redirect to `/login`.
- (Skip the actual Google login if env not yet configured — verify visually that the Login page renders without runtime errors.)

- [ ] **Step 3: Commit**

```bash
git add client/src/library/LibraryPage.jsx
git commit -m "feat(client): LibraryPage with list, search, upload, select, delete"
```

---

## Phase 7 — Frontend: Reader page

### Task 7.1: ReaderPage with epub.js + position persistence

**Files:**
- Modify: `client/src/reader/ReaderPage.jsx`
- Create: `client/src/reader/reader.module.css`

- [ ] **Step 1: Write `client/src/reader/reader.module.css`**

```css
.page {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
}
.header {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}
.back {
  background: transparent; border: 1px solid var(--border);
  width: 36px; height: 36px; border-radius: 50%;
  font-size: 18px; cursor: pointer; color: inherit;
}
.title {
  flex: 1; margin: 0;
  font-size: 14px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pct { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }

.viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
}
.viewport > div { height: 100%; }

.navBtn {
  position: absolute;
  top: 50%; transform: translateY(-50%);
  background: rgba(0,0,0,.05);
  border: none;
  width: 44px; height: 88px;
  font-size: 24px;
  color: inherit;
  cursor: pointer;
  display: grid; place-items: center;
  border-radius: 8px;
  opacity: 0;
  transition: opacity .2s;
}
.viewport:hover .navBtn { opacity: 1; }
@media (hover: none) { .navBtn { opacity: 1; } }
.navPrev { left: 8px; }
.navNext { right: 8px; }

.loading {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  color: var(--muted);
}
```

- [ ] **Step 2: Write `client/src/reader/ReaderPage.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ePub from 'epubjs';
import styles from './reader.module.css';
import { api, bookFileUrl, getToken } from '../lib/api.js';
import { percent } from '../lib/format.js';

const SAVE_THROTTLE_MS = 3000;

export default function ReaderPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const viewportRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const lastSaveRef = useRef(0);
  const pendingRef = useRef(null);
  const saveTimerRef = useRef(null);
  const [pct, setPct] = useState(0);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let disposed = false;

    async function start() {
      try {
        const [progress, fileRes] = await Promise.all([
          api.getProgress(bookId),
          fetch(bookFileUrl(bookId), { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (!fileRes.ok) throw new Error('No se pudo cargar el libro');
        const buf = await fileRes.arrayBuffer();
        if (disposed) return;

        const book = ePub(buf);
        bookRef.current = book;
        const rendition = book.renderTo(viewportRef.current, {
          width: '100%', height: '100%', flow: 'paginated', spread: 'auto',
        });
        renditionRef.current = rendition;

        book.loaded.metadata.then((m) => { if (!disposed) setTitle(m?.title || ''); });

        await rendition.display(progress?.cfi || undefined);
        setLoading(false);

        rendition.on('relocated', (loc) => {
          const next = {
            cfi: loc.start.cfi,
            percentage: loc.start.percentage ?? 0,
          };
          setPct(next.percentage);
          pendingRef.current = next;
          scheduleSave();
        });

        // Keyboard navigation
        const onKey = (e) => {
          if (e.key === 'ArrowLeft') rendition.prev();
          else if (e.key === 'ArrowRight') rendition.next();
        };
        document.addEventListener('keydown', onKey);

        // Swipe navigation
        let touchX = null;
        const onTouchStart = (e) => { touchX = e.changedTouches[0].clientX; };
        const onTouchEnd = (e) => {
          if (touchX == null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          if (Math.abs(dx) > 50) (dx < 0 ? rendition.next() : rendition.prev());
          touchX = null;
        };
        viewportRef.current.addEventListener('touchstart', onTouchStart);
        viewportRef.current.addEventListener('touchend', onTouchEnd);

        const onBeforeUnload = () => flushSave(true);
        window.addEventListener('beforeunload', onBeforeUnload);

        rendition.__cleanup = () => {
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('beforeunload', onBeforeUnload);
        };
      } catch (e) {
        setError(e.message);
        setLoading(false);
      }
    }

    start();
    return () => {
      disposed = true;
      flushSave(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (renditionRef.current?.__cleanup) renditionRef.current.__cleanup();
      try { renditionRef.current?.destroy(); } catch {}
      try { bookRef.current?.destroy(); } catch {}
    };
  }, [bookId]);

  function scheduleSave() {
    const now = Date.now();
    const elapsed = now - lastSaveRef.current;
    if (elapsed >= SAVE_THROTTLE_MS) flushSave(false);
    else if (!saveTimerRef.current) {
      saveTimerRef.current = setTimeout(() => flushSave(false), SAVE_THROTTLE_MS - elapsed);
    }
  }

  function flushSave(isUnload) {
    const data = pendingRef.current;
    if (!data) return;
    pendingRef.current = null;
    lastSaveRef.current = Date.now();
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }

    if (isUnload && navigator.sendBeacon) {
      const token = getToken();
      const blob = new Blob(
        [JSON.stringify({ cfi: data.cfi, percentage: data.percentage, _t: token })],
        { type: 'application/json' }
      );
      // Best effort — sendBeacon ignores custom headers, so we POST to a dedicated path
      // that accepts the token in body. For simplicity here we just call the API; if the
      // page is unloading the request may not complete, but the throttled save covers most cases.
      navigator.sendBeacon(`/api/books/${bookId}/progress`, blob);
      return;
    }
    api.putProgress(bookId, data.cfi, data.percentage).catch(() => {});
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')} aria-label="Volver">←</button>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.pct}>{percent(pct)}</span>
      </header>
      <div className={styles.viewport} ref={viewportRef}>
        {loading && <div className={styles.loading}>Cargando libro…</div>}
        {error && <div className={styles.loading} style={{ color: '#b00020' }}>{error}</div>}
        <button className={`${styles.navBtn} ${styles.navPrev}`} aria-label="Anterior"
          onClick={() => renditionRef.current?.prev()}>‹</button>
        <button className={`${styles.navBtn} ${styles.navNext}`} aria-label="Siguiente"
          onClick={() => renditionRef.current?.next()}>›</button>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Manual smoke test (deferred to Task 8.1)**

The reader needs a real Google login to upload a book first. Full manual test happens after end-to-end wire-up.

- [ ] **Step 4: Commit**

```bash
git add client/src/reader/
git commit -m "feat(client): ReaderPage with epub.js, cfi persistence, swipe/keyboard nav"
```

---

## Phase 8 — End-to-end verification

### Task 8.1: Local end-to-end manual test

This task has no code changes; it verifies the spec's acceptance criteria.

**Prerequisites:** the user must create an OAuth Web client in Google Cloud Console with `http://localhost:5173` and `http://localhost:3001` as authorized JavaScript origins, and put the Client ID into `server/.env` and `client/.env`.

- [ ] **Step 1: Configure env**

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
# Edit both to set GOOGLE_CLIENT_ID / VITE_GOOGLE_CLIENT_ID
# Generate a JWT_SECRET, e.g.:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- [ ] **Step 2: Run server and client in dev**

Two terminals:
```bash
npm run dev:server
```
```bash
npm run dev:client
```

- [ ] **Step 3: Walk through acceptance criteria**

Open `http://localhost:5173` and verify each item:

- [ ] Login with Google succeeds and lands on `/`.
- [ ] Header shows "epubReader" and the avatar/Salir.
- [ ] Upload an EPUB → it appears in the grid with cover, title, author.
- [ ] Search filters as you type.
- [ ] Enter "Seleccionar", mark one or more, "Eliminar" with confirm removes them.
- [ ] Click a book → reader opens; navigate with arrows, swipe, and edge buttons.
- [ ] Close the reader tab, reopen the same book → it resumes on the same page.
- [ ] On the library, the book's `%` and "última lectura" updated.
- [ ] Resize the window from 320px wide to 1920px wide; layout stays usable; covers reflow.
- [ ] Open DevTools, try `fetch('/api/books/<anothersId>/file', {headers:{Authorization:'Bearer '+localStorage.getItem('epubreader.token')}})` for a book that doesn't belong to you → 404.

If anything fails, file follow-up tasks; otherwise mark the spec's acceptance criteria as complete.

- [ ] **Step 4: Build the client and run prod server**

```bash
npm run build:client
NODE_ENV=production npm start
```
Open `http://localhost:3001` → should serve the SPA + API on the same port. Repeat one or two acceptance items.

- [ ] **Step 5: Commit any tweaks discovered during the walk-through**

```bash
git add -A
git commit -m "fix: address issues found during e2e walk-through"
```
(Skip if no changes were needed.)

---

## Done

All acceptance criteria from the spec should be satisfied. Future work (out of scope) lives in spec section 12.
