# Libros Compartidos, Modo Invitado y Puntuaciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la página principal en dos secciones (Mis Libros / Libros Compartidos), permitir entrar sin sesión (modo invitado), compartir libros para que cualquiera los lea, y puntuarlos con estrellas (solo usuarios registrados) ordenando la vitrina por puntuación.

**Architecture:** Backend Express/SQLite con un namespace público nuevo `/api/shared` (sin auth, sólo sirve libros con `shared=1`), una columna `books.shared` y una tabla `ratings`. Frontend React: `/` y `/read/:bookId` se vuelven públicas; la `LibraryPage` muestra una sección de invitado o de usuario según haya sesión, más una vitrina de compartidos; el lector entra en "modo compartido" (progreso local, sin anotaciones) vía `?shared=1`.

**Tech Stack:** Node + Express + better-sqlite3, vitest + supertest (servidor); React + react-router-dom + Vite, CSS Modules (cliente).

**Spec:** `docs/superpowers/specs/2026-05-29-libros-compartidos-design.md`

---

## File Structure

**Backend (crear):**
- `server/src/middleware/authOptional.js` — setea `req.user` si hay token válido, sin exigirlo.
- `server/src/routes/shared.js` — router público de libros compartidos + puntuaciones.
- `server/tests/shared.test.js` — tests del router público y puntuaciones.
- `server/tests/books_share.test.js` — tests de share/unshare en el router privado.

**Backend (modificar):**
- `server/src/db.js` — columna `books.shared`, tabla `ratings`, migración.
- `server/src/routes/books.js` — campo `shared` en el listado; rutas `share`/`unshare`.
- `server/src/app.js` — montar el router `shared`.

**Frontend (crear):**
- `client/src/auth/GoogleSignInButton.jsx` — botón Google reutilizable (web + nativo).
- `client/src/library/StarRating.jsx` — estrellas (lectura / interactivo).
- `client/src/library/SharedShelf.jsx` — sección "Libros Compartidos".

**Frontend (modificar):**
- `client/src/lib/api.js` — endpoints `listShared`, `shareBooks`, `unshareBooks`, `rateShared`, `unrateShared`, `sharedFileUrl`, `sharedCoverUrl`.
- `client/src/App.jsx` — `/` y `/read/:bookId` públicas; `*` → `/login`.
- `client/src/auth/LoginPage.jsx` — usar `GoogleSignInButton`; enlace "Entrar sin iniciar sesión"; redirigir si ya hay sesión.
- `client/src/library/LibraryPage.jsx` — dos secciones, modo invitado, compartir.
- `client/src/library/Toolbar.jsx` — botones Compartir / Dejar de compartir.
- `client/src/library/BookCard.jsx` — insignia 🔗 y variante de portada compartida.
- `client/src/reader/ReaderPage.jsx` — modo compartido (endpoint público, progreso local, sin anotaciones).
- `client/src/library/library.module.css` — estilos de secciones, insignia y estrellas.

---

## Task 1: Migración de DB — columna `shared` y tabla `ratings`

**Files:**
- Modify: `server/src/db.js:5-50` (SCHEMA) y `server/src/db.js:63-79` (migraciones en `openDb`)
- Test: `server/tests/db.test.js`

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `server/tests/db.test.js`, dentro del `describe('db.openDb', ...)`:

```js
  it('adds a shared column to books (default 0)', () => {
    const cols = db.prepare('PRAGMA table_info(books)').all().map(c => c.name);
    expect(cols).toContain('shared');
    const userId = db.prepare('INSERT INTO users (google_sub, email) VALUES (?, ?)').run('s2', 'c@d.com').lastInsertRowid;
    db.prepare('INSERT INTO books (user_id, title, file_path) VALUES (?, ?, ?)').run(userId, 'T', 'p');
    const row = db.prepare('SELECT shared FROM books LIMIT 1').get();
    expect(row.shared).toBe(0);
  });

  it('creates a ratings table with a 1..5 check and cascade on book delete', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('ratings');

    const userId = db.prepare('INSERT INTO users (google_sub, email) VALUES (?, ?)').run('s3', 'e@f.com').lastInsertRowid;
    const bookId = db.prepare('INSERT INTO books (user_id, title, file_path) VALUES (?, ?, ?)').run(userId, 'T', 'p').lastInsertRowid;
    db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(bookId, userId, 5);
    expect(() => db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(bookId, userId, 9)).toThrow();

    db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM ratings').get();
    expect(remaining.c).toBe(0);
  });
```

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `npm test -w server -- db.test.js`
Expected: FAIL — la columna `shared` y la tabla `ratings` no existen.

- [ ] **Step 3: Implementar el cambio mínimo**

En `server/src/db.js`, dentro del template `SCHEMA`, añadir la columna `shared` a la tabla `books` (después de `format`):

```sql
  format        TEXT    NOT NULL DEFAULT 'epub',
  shared        INTEGER NOT NULL DEFAULT 0,
  uploaded_at   TEXT    DEFAULT CURRENT_TIMESTAMP
```

Y añadir la tabla `ratings` al final del template `SCHEMA` (antes del cierre con backtick):

```sql
CREATE TABLE IF NOT EXISTS ratings (
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  updated_at TEXT    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (book_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_book ON ratings(book_id);
```

En `openDb`, después de las migraciones existentes (tras el bloque de `annotations.page`), añadir la migración de `shared` para DBs preexistentes:

```js
  // Migration: add shared flag to pre-existing books.
  if (!hasColumn(db, 'books', 'shared')) {
    db.exec('ALTER TABLE books ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
  }
```

- [ ] **Step 4: Ejecutar para ver que pasa**

Run: `npm test -w server -- db.test.js`
Expected: PASS (todos los tests del archivo).

- [ ] **Step 5: Commit**

```bash
git add server/src/db.js server/tests/db.test.js
git commit -m "feat(db): add books.shared column and ratings table"
```

---

## Task 2: Middleware `authOptional`

**Files:**
- Create: `server/src/middleware/authOptional.js`
- Test: `server/tests/auth_optional.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `server/tests/auth_optional.test.js`:

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { authOptional } from '../src/middleware/authOptional.js';
import { signJwt } from '../src/auth.js';

process.env.NODE_ENV = 'test';

function app() {
  const a = express();
  a.use(express.json());
  a.use(authOptional);
  a.get('/who', (req, res) => res.json({ user: req.user }));
  return a;
}

describe('authOptional', () => {
  it('sets req.user to null when there is no token', async () => {
    const res = await request(app()).get('/who');
    expect(res.status).toBe(200);
    expect(res.body.user).toBe(null);
  });

  it('sets req.user from a valid Bearer token', async () => {
    const token = signJwt({ sub: 7, email: 'g@h.com' });
    const res = await request(app()).get('/who').set('Authorization', `Bearer ${token}`);
    expect(res.body.user.sub).toBe(7);
  });

  it('treats an invalid token as anonymous (no 401)', async () => {
    const res = await request(app()).get('/who').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(200);
    expect(res.body.user).toBe(null);
  });
});
```

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `npm test -w server -- auth_optional.test.js`
Expected: FAIL — `authOptional` no existe.

- [ ] **Step 3: Implementar el middleware**

Crear `server/src/middleware/authOptional.js`:

```js
import { verifyJwt } from '../auth.js';

export function authOptional(req, _res, next) {
  let token = null;
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (match) {
    token = match[1];
  } else if (req.body && typeof req.body._t === 'string') {
    token = req.body._t;
    delete req.body._t;
  } else if (req.query && typeof req.query._t === 'string') {
    token = req.query._t;
  }
  req.user = null;
  if (token) {
    try {
      const payload = verifyJwt(token);
      req.user = { sub: payload.sub, email: payload.email };
    } catch { /* anonymous */ }
  }
  next();
}
```

- [ ] **Step 4: Ejecutar para ver que pasa**

Run: `npm test -w server -- auth_optional.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware/authOptional.js server/tests/auth_optional.test.js
git commit -m "feat(server): add authOptional middleware"
```

---

## Task 3: Rutas `share` / `unshare` y campo `shared` en el listado

**Files:**
- Modify: `server/src/routes/books.js:47-67` (listado) y añadir rutas tras el `DELETE /` (`server/src/routes/books.js:173`)
- Test: `server/tests/books_share.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `server/tests/books_share.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createBooksRouter } from '../src/routes/books.js';

process.env.NODE_ENV = 'test';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/books', createBooksRouter(db, '/tmp/test-data'));
  return a;
}

function insertBook(db, userId, title = 'Book') {
  return db.prepare("INSERT INTO books (user_id, title, file_path, format) VALUES (?, ?, 'p', 'epub')")
    .run(userId, title).lastInsertRowid;
}

describe('books share/unshare', () => {
  let db, alice, bob, a;
  beforeEach(() => {
    db = makeDb();
    alice = insertUser(db, { email: 'alice@x.com', name: 'Alice' });
    bob = insertUser(db, { email: 'bob@x.com', name: 'Bob' });
    a = app(db);
  });

  it('marks owned books as shared and ignores ids of other users', async () => {
    const mine = insertBook(db, alice.id);
    const hers = insertBook(db, bob.id);
    const res = await request(a).post('/api/books/share')
      .set(authHeader(alice)).send({ ids: [mine, hers] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(db.prepare('SELECT shared FROM books WHERE id = ?').get(mine).shared).toBe(1);
    expect(db.prepare('SELECT shared FROM books WHERE id = ?').get(hers).shared).toBe(0);
  });

  it('unshares owned books', async () => {
    const mine = insertBook(db, alice.id);
    await request(a).post('/api/books/share').set(authHeader(alice)).send({ ids: [mine] });
    const res = await request(a).post('/api/books/unshare').set(authHeader(alice)).send({ ids: [mine] });
    expect(res.body.updated).toBe(1);
    expect(db.prepare('SELECT shared FROM books WHERE id = ?').get(mine).shared).toBe(0);
  });

  it('includes the shared field in the listing', async () => {
    const mine = insertBook(db, alice.id);
    await request(a).post('/api/books/share').set(authHeader(alice)).send({ ids: [mine] });
    const res = await request(a).get('/api/books').set(authHeader(alice));
    expect(res.body[0]).toHaveProperty('shared', 1);
  });
});
```

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `npm test -w server -- books_share.test.js`
Expected: FAIL — `/api/books/share` no existe y el listado no trae `shared`.

- [ ] **Step 3: Implementar**

En `server/src/routes/books.js`, en el `GET /` (listado), añadir `b.shared` al SELECT y al objeto devuelto.

Cambiar el SELECT (línea ~50) para incluir `b.shared`:

```js
      SELECT b.id, b.title, b.author, b.cover_path, b.uploaded_at, b.format, b.shared,
             COALESCE(p.percentage, 0) AS percentage,
             p.last_read_at AS last_read_at
```

Y en el `res.json(rows.map(...))` añadir el campo:

```js
      format: row.format,
      shared: row.shared,
      coverUrl: row.cover_path ? `/api/books/${row.id}/cover` : null,
```

Justo después del handler `r.delete('/', ...)` (antes de `function getOwnedBook`), añadir:

```js
  function setShared(req, res, value) {
    const userId = req.user.sub;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
    if (ids.length === 0) return res.json({ updated: 0 });
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(
      `UPDATE books SET shared = ? WHERE user_id = ? AND id IN (${placeholders})`
    ).run(value, userId, ...ids);
    res.json({ updated: result.changes });
  }

  r.post('/share', (req, res) => setShared(req, res, 1));
  r.post('/unshare', (req, res) => setShared(req, res, 0));
```

> Nota: estas rutas deben quedar **antes** de las rutas con parámetro `/:id/...` para que `share`/`unshare` no sean capturadas como un `:id`. Colócalas justo tras `r.delete('/', ...)`.

- [ ] **Step 4: Ejecutar para ver que pasa**

Run: `npm test -w server -- books_share.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/books.js server/tests/books_share.test.js
git commit -m "feat(server): share/unshare books and expose shared flag"
```

---

## Task 4: Router público `/api/shared` — listado, archivo y portada

**Files:**
- Create: `server/src/routes/shared.js`
- Test: `server/tests/shared.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `server/tests/shared.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createSharedRouter } from '../src/routes/shared.js';
import { ensureUserDir, bookPath } from '../src/storage.js';

process.env.NODE_ENV = 'test';

function app(db, dataDir) {
  const a = express();
  a.use(express.json());
  a.use('/api/shared', createSharedRouter(db, dataDir));
  return a;
}

function insertBook(db, userId, { title = 'Book', shared = 0 } = {}) {
  return db.prepare("INSERT INTO books (user_id, title, file_path, format, shared) VALUES (?, ?, 'p', 'epub', ?)")
    .run(userId, title, shared).lastInsertRowid;
}

describe('shared router', () => {
  let db, dataDir, alice, bob, a;
  beforeEach(() => {
    db = makeDb();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-'));
    alice = insertUser(db, { email: 'alice@x.com', name: 'Alice' });
    bob = insertUser(db, { email: 'bob@x.com', name: 'Bob' });
    a = app(db, dataDir);
  });
  afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

  it('lists only shared books with owner name, for an anonymous caller', async () => {
    insertBook(db, alice.id, { title: 'Private' });
    insertBook(db, alice.id, { title: 'Public', shared: 1 });
    const res = await request(a).get('/api/shared');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ title: 'Public', sharedBy: 'Alice', mine: false, avgStars: null, ratingCount: 0, myStars: null });
    expect(res.body[0].coverUrl).toContain('/api/shared/');
  });

  it('marks mine=true and includes myStars for the authenticated owner', async () => {
    const id = insertBook(db, alice.id, { shared: 1 });
    db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(id, alice.id, 4);
    const res = await request(a).get('/api/shared').set(authHeader(alice));
    expect(res.body[0].mine).toBe(true);
    expect(res.body[0].myStars).toBe(4);
    expect(res.body[0].avgStars).toBe(4);
    expect(res.body[0].ratingCount).toBe(1);
  });

  it('orders by average desc, then vote count, with unrated last', async () => {
    const high = insertBook(db, alice.id, { title: 'High', shared: 1 });   // avg 5, 1 vote
    const mid = insertBook(db, alice.id, { title: 'Mid', shared: 1 });     // avg 4, 2 votes
    const none = insertBook(db, alice.id, { title: 'None', shared: 1 });   // no votes
    db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(high, alice.id, 5);
    db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(mid, alice.id, 4);
    db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(mid, bob.id, 4);
    const res = await request(a).get('/api/shared');
    expect(res.body.map(b => b.title)).toEqual(['High', 'Mid', 'None']);
  });

  it('serves the file only when shared', async () => {
    const shared = insertBook(db, alice.id, { shared: 1 });
    const priv = insertBook(db, alice.id, { shared: 0 });
    ensureUserDir(dataDir, alice.id);
    fs.writeFileSync(bookPath(dataDir, alice.id, shared, 'epub'), 'EPUBDATA');
    const ok = await request(a).get(`/api/shared/${shared}/file`);
    expect(ok.status).toBe(200);
    const blocked = await request(a).get(`/api/shared/${priv}/file`);
    expect(blocked.status).toBe(404);
  });
});
```

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `npm test -w server -- shared.test.js`
Expected: FAIL — `createSharedRouter` no existe.

- [ ] **Step 3: Implementar el router**

Crear `server/src/routes/shared.js`:

```js
import { Router } from 'express';
import path from 'node:path';
import { authOptional } from '../middleware/authOptional.js';
import { bookPath } from '../storage.js';

export function createSharedRouter(db, dataDir) {
  const r = Router();
  r.use(authOptional);

  function aggregate(bookId, userId) {
    const agg = db.prepare(
      'SELECT COUNT(*) AS c, AVG(stars) AS avg FROM ratings WHERE book_id = ?'
    ).get(bookId);
    const mine = userId != null
      ? db.prepare('SELECT stars FROM ratings WHERE book_id = ? AND user_id = ?').get(bookId, userId)
      : null;
    return {
      avgStars: agg.avg != null ? Number(agg.avg) : null,
      ratingCount: agg.c,
      myStars: mine ? mine.stars : null,
    };
  }

  function sharedBook(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const row = db.prepare('SELECT * FROM books WHERE id = ? AND shared = 1').get(id);
    if (!row) { res.status(404).end(); return null; }
    return row;
  }

  r.get('/', (req, res) => {
    const me = req.user ? req.user.sub : -1;
    const rows = db.prepare(`
      SELECT b.id, b.title, b.author, b.format, b.cover_path, b.uploaded_at, b.user_id,
             u.name AS owner_name, u.email AS owner_email,
             COUNT(rt.stars) AS rating_count,
             AVG(rt.stars) AS avg_stars,
             mr.stars AS my_stars
        FROM books b
        JOIN users u ON u.id = b.user_id
        LEFT JOIN ratings rt ON rt.book_id = b.id
        LEFT JOIN ratings mr ON mr.book_id = b.id AND mr.user_id = ?
       WHERE b.shared = 1
       GROUP BY b.id
       ORDER BY (COUNT(rt.stars) = 0), AVG(rt.stars) DESC, COUNT(rt.stars) DESC, b.uploaded_at DESC
    `).all(me);

    res.json(rows.map(row => ({
      id: row.id,
      title: row.title,
      author: row.author,
      format: row.format,
      coverUrl: row.cover_path ? `/api/shared/${row.id}/cover` : null,
      sharedBy: row.owner_name || row.owner_email,
      mine: req.user ? row.user_id === req.user.sub : false,
      avgStars: row.avg_stars != null ? Number(row.avg_stars) : null,
      ratingCount: row.rating_count,
      myStars: row.my_stars != null ? row.my_stars : null,
    })));
  });

  r.get('/:id/file', (req, res) => {
    const book = sharedBook(req, res);
    if (!book) return;
    const format = book.format || 'epub';
    const file = bookPath(dataDir, book.user_id, book.id, format);
    const mime = format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
    res.type(mime).sendFile(file);
  });

  r.get('/:id/cover', (req, res) => {
    const book = sharedBook(req, res);
    if (!book) return;
    if (!book.cover_path) return res.status(404).end();
    res.sendFile(path.join(dataDir, book.cover_path));
  });

  r.put('/:id/rating', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    const stars = req.body?.stars;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'invalid_stars' });
    }
    const book = sharedBook(req, res);
    if (!book) return;
    db.prepare(`
      INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)
      ON CONFLICT(book_id, user_id) DO UPDATE SET stars = excluded.stars, updated_at = CURRENT_TIMESTAMP
    `).run(book.id, req.user.sub, stars);
    res.json(aggregate(book.id, req.user.sub));
  });

  r.delete('/:id/rating', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    const book = sharedBook(req, res);
    if (!book) return;
    db.prepare('DELETE FROM ratings WHERE book_id = ? AND user_id = ?').run(book.id, req.user.sub);
    res.json(aggregate(book.id, req.user.sub));
  });

  return r;
}
```

- [ ] **Step 4: Ejecutar para ver que pasa**

Run: `npm test -w server -- shared.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/shared.js server/tests/shared.test.js
git commit -m "feat(server): public /api/shared router with listing, file, cover"
```

---

## Task 5: Tests de puntuación (rating) en el router público

**Files:**
- Test: `server/tests/shared.test.js` (añadir un `describe` nuevo)

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `server/tests/shared.test.js` (fuera del `describe` existente, reutilizando los mismos imports):

```js
describe('shared ratings', () => {
  let db, dataDir, alice, bob, a;
  beforeEach(() => {
    db = makeDb();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-'));
    alice = insertUser(db, { email: 'alice@x.com', name: 'Alice' });
    bob = insertUser(db, { email: 'bob@x.com', name: 'Bob' });
    a = app(db, dataDir);
  });
  afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

  it('rejects rating without a session (401)', async () => {
    const id = insertBook(db, alice.id, { shared: 1 });
    const res = await request(a).put(`/api/shared/${id}/rating`).send({ stars: 4 });
    expect(res.status).toBe(401);
  });

  it('rejects stars outside 1..5 (400)', async () => {
    const id = insertBook(db, alice.id, { shared: 1 });
    const res = await request(a).put(`/api/shared/${id}/rating`).set(authHeader(bob)).send({ stars: 6 });
    expect(res.status).toBe(400);
  });

  it('upserts a rating and returns recalculated aggregates', async () => {
    const id = insertBook(db, alice.id, { shared: 1 });
    let res = await request(a).put(`/api/shared/${id}/rating`).set(authHeader(bob)).send({ stars: 4 });
    expect(res.body).toMatchObject({ avgStars: 4, ratingCount: 1, myStars: 4 });
    res = await request(a).put(`/api/shared/${id}/rating`).set(authHeader(bob)).send({ stars: 2 });
    expect(res.body).toMatchObject({ avgStars: 2, ratingCount: 1, myStars: 2 });
  });

  it('refuses to rate a non-shared book (404)', async () => {
    const id = insertBook(db, alice.id, { shared: 0 });
    const res = await request(a).put(`/api/shared/${id}/rating`).set(authHeader(bob)).send({ stars: 3 });
    expect(res.status).toBe(404);
  });

  it('deletes my rating', async () => {
    const id = insertBook(db, alice.id, { shared: 1 });
    await request(a).put(`/api/shared/${id}/rating`).set(authHeader(bob)).send({ stars: 4 });
    const res = await request(a).delete(`/api/shared/${id}/rating`).set(authHeader(bob));
    expect(res.body).toMatchObject({ avgStars: null, ratingCount: 0, myStars: null });
  });
});
```

- [ ] **Step 2: Ejecutar para ver que pasa (ya implementado en Task 4)**

Run: `npm test -w server -- shared.test.js`
Expected: PASS — la lógica de rating ya existe; estos tests la cubren.

- [ ] **Step 3: Commit**

```bash
git add server/tests/shared.test.js
git commit -m "test(server): cover shared rating put/delete/validation"
```

---

## Task 6: Montar el router público en la app

**Files:**
- Modify: `server/src/app.js:11-14` (imports) y `server/src/app.js:73-75` (montaje)

- [ ] **Step 1: Escribir el test que falla**

Crear `server/tests/app_shared.test.js`:

```js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeDb } from './helpers.js';
import { createApp } from '../src/app.js';

process.env.NODE_ENV = 'test';

describe('app mounts /api/shared publicly', () => {
  it('returns an array without authentication', async () => {
    const app = createApp({ db: makeDb(), dataDir: '/tmp/test-data' });
    const res = await request(app).get('/api/shared');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `npm test -w server -- app_shared.test.js`
Expected: FAIL — `/api/shared` devuelve 404 (no montado).

- [ ] **Step 3: Implementar el montaje**

En `server/src/app.js`, añadir el import junto a los otros routers (tras la línea de `createAnnotationsRouter`):

```js
import { createSharedRouter } from './routes/shared.js';
```

Y montarlo junto a los demás `/api/books` (tras `app.use('/api/books', createAnnotationsRouter(db));`):

```js
  app.use('/api/shared', createSharedRouter(db, dataDir));
```

- [ ] **Step 4: Ejecutar para ver que pasa**

Run: `npm test -w server` (toda la suite del servidor)
Expected: PASS — todos los tests verdes.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.js server/tests/app_shared.test.js
git commit -m "feat(server): mount public /api/shared router"
```

---

## Task 7: Cliente API — endpoints de compartidos y puntuación

**Files:**
- Modify: `client/src/lib/api.js:48-99`

- [ ] **Step 1: Añadir métodos al objeto `api` y los helpers de URL**

En `client/src/lib/api.js`, dentro del objeto `api` (tras `deleteBooks`), añadir:

```js
  listShared: () => call('/api/shared'),
  shareBooks: (ids) => call('/api/books/share', { method: 'POST', body: { ids } }),
  unshareBooks: (ids) => call('/api/books/unshare', { method: 'POST', body: { ids } }),
  rateShared: (bookId, stars) =>
    call(`/api/shared/${bookId}/rating`, { method: 'PUT', body: { stars } }),
  unrateShared: (bookId) =>
    call(`/api/shared/${bookId}/rating`, { method: 'DELETE' }),
```

Al final del archivo (tras `bookCoverUrl`), añadir los helpers públicos:

```js
export function sharedFileUrl(bookId) {
  return `${BASE}/api/shared/${bookId}/file`;
}
export function sharedCoverUrl(bookId) {
  return `${BASE}/api/shared/${bookId}/cover`;
}
```

- [ ] **Step 2: Verificar que el cliente compila**

Run: `npm run build:client`
Expected: build exitoso (sin errores de sintaxis/imports).

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/api.js
git commit -m "feat(client): api methods for shared books and ratings"
```

---

## Task 8: Extraer `GoogleSignInButton` reutilizable

**Files:**
- Create: `client/src/auth/GoogleSignInButton.jsx`
- Modify: `client/src/auth/LoginPage.jsx`

- [ ] **Step 1: Crear el componente**

Crear `client/src/auth/GoogleSignInButton.jsx` (mueve la lógica GSI web + nativa de `LoginPage`):

```jsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { useAuth } from './AuthContext.jsx';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const IS_NATIVE = Capacitor.isNativePlatform();

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

export default function GoogleSignInButton({ className, nativeClassName }) {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const btnRef = useRef(null);
  const [error, setError] = useState(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (IS_NATIVE) {
      try { GoogleAuth.initialize(); } catch (e) { console.warn('GoogleAuth init', e); }
      return;
    }
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

  const nativeSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const user = await GoogleAuth.signIn();
      const credential = user.authentication?.idToken;
      if (!credential) throw new Error('plugin returned no idToken');
      await loginWithGoogle(credential);
      navigate('/', { replace: true });
    } catch (e) {
      console.error('[native sign-in]', e);
      const detail = e?.code != null ? `code ${e.code}` : (e?.message || String(e));
      setError(`Falló el login: ${detail}`);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <>
      {IS_NATIVE ? (
        <button className={nativeClassName} onClick={nativeSignIn} disabled={signingIn}>
          {signingIn ? 'Iniciando…' : 'Iniciar sesión con Google'}
        </button>
      ) : (
        <div ref={btnRef} className={className} />
      )}
      {error && <p style={{ color: '#b00020', marginTop: 8 }}>{error}</p>}
    </>
  );
}
```

- [ ] **Step 2: Usar el componente en `LoginPage`**

Reemplazar el cuerpo de `client/src/auth/LoginPage.jsx` por una versión que usa el botón extraído, redirige si ya hay sesión, y añade "Entrar sin iniciar sesión":

```jsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';
import styles from './login.module.css';
import PitchSection from '../lib/PitchSection.jsx';

export default function LoginPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) navigate('/', { replace: true });
  }, [token, navigate]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <img src="/favicon.svg" alt="" width="96" height="96" className={styles.logo} />
        <h1 className={styles.title}>MisLibros</h1>
        <p className={styles.tagline}>Tu biblioteca personal en la nube.</p>
        <p className={styles.lead}>
          Lee EPUB y PDF desde cualquier dispositivo. Tu progreso se
          sincroniza automáticamente — empieza un libro en tu computadora
          y termínalo en el celular.
        </p>
        <GoogleSignInButton className={styles.btnSlot} nativeClassName={styles.nativeBtn} />
        <button className={styles.guestLink} onClick={() => navigate('/')}>
          Entrar sin iniciar sesión
        </button>
      </div>

      <PitchSection />
    </main>
  );
}
```

- [ ] **Step 3: Añadir el estilo del enlace de invitado**

En `client/src/auth/login.module.css`, añadir:

```css
.guestLink {
  margin-top: 14px;
  background: none;
  border: none;
  color: #4060c0;
  font-size: 0.95rem;
  text-decoration: underline;
  cursor: pointer;
}
```

- [ ] **Step 4: Verificar build**

Run: `npm run build:client`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add client/src/auth/GoogleSignInButton.jsx client/src/auth/LoginPage.jsx client/src/auth/login.module.css
git commit -m "feat(client): reusable GoogleSignInButton + guest entry on login"
```

---

## Task 9: Rutas públicas en `App.jsx`

**Files:**
- Modify: `client/src/App.jsx:24-31`

- [ ] **Step 1: Quitar `ProtectedRoute` de `/` y `/read/:bookId`**

En `client/src/App.jsx`, reemplazar el bloque `<Routes>`:

```jsx
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<LibraryPage />} />
      <Route path="/read/:bookId" element={<ReaderPage />} />
      <Route path="*" element={<LoginPage />} />
    </Routes>
  );
```

Eliminar también el import ahora sin uso: `import { ProtectedRoute } from './auth/ProtectedRoute.jsx';`.

> `ProtectedRoute.jsx` se conserva en el repo por si se reutiliza, pero ya no se importa.

- [ ] **Step 2: Verificar build**

Run: `npm run build:client`
Expected: build exitoso (sin import sin usar que rompa, Vite tolera; si el linter falla, confirmar que se quitó el import).

- [ ] **Step 3: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat(client): make library and reader routes public"
```

---

## Task 10: Componente `StarRating`

**Files:**
- Create: `client/src/library/StarRating.jsx`
- Modify: `client/src/library/library.module.css`

- [ ] **Step 1: Crear el componente**

Crear `client/src/library/StarRating.jsx`:

```jsx
import { useState } from 'react';
import styles from './library.module.css';

// avg: número|null, count: entero, myStars: 1..5|null
// interactive: si true, permite votar (onRate(stars)) y quitar voto (onClear)
export default function StarRating({ avg, count, myStars, interactive, onRate, onClear }) {
  const [hover, setHover] = useState(0);
  const filledTo = interactive
    ? (hover || myStars || 0)
    : Math.round(avg || 0);

  const stars = [1, 2, 3, 4, 5].map((n) => {
    const on = n <= filledTo;
    if (!interactive) {
      return <span key={n} className={on ? styles.starOn : styles.starOff}>★</span>;
    }
    return (
      <button
        key={n}
        type="button"
        className={`${styles.starBtn} ${on ? styles.starOn : styles.starOff}`}
        onMouseEnter={() => setHover(n)}
        onMouseLeave={() => setHover(0)}
        onClick={(e) => {
          e.stopPropagation();
          if (myStars === n && onClear) onClear();
          else onRate?.(n);
        }}
        aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
      >★</button>
    );
  });

  return (
    <div className={styles.rating} title={interactive ? 'Tu puntuación' : 'Puntuación promedio'}>
      <span className={styles.stars}>{stars}</span>
      <span className={styles.ratingMeta}>
        {avg != null ? `${avg.toFixed(1)} (${count})` : 'Sin votos'}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Añadir estilos**

En `client/src/library/library.module.css`, añadir:

```css
.rating { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.stars { display: inline-flex; gap: 1px; font-size: 0.95rem; line-height: 1; }
.starOn { color: #f5a623; }
.starOff { color: #c9ccd4; }
.starBtn { background: none; border: none; padding: 0 1px; cursor: pointer; font-size: 0.95rem; line-height: 1; }
.ratingMeta { font-size: 0.72rem; color: #6b7280; }
```

- [ ] **Step 3: Verificar build**

Run: `npm run build:client`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add client/src/library/StarRating.jsx client/src/library/library.module.css
git commit -m "feat(client): StarRating component (read-only + interactive)"
```

---

## Task 11: `BookCard` — insignia compartido y portada pública

**Files:**
- Modify: `client/src/library/BookCard.jsx`
- Modify: `client/src/library/library.module.css`

- [ ] **Step 1: Soportar portada pública e insignia**

En `client/src/library/BookCard.jsx`, cambiar el import de api para incluir `sharedCoverUrl`:

```jsx
import { bookCoverUrl, sharedCoverUrl, getToken } from '../lib/api.js';
```

Aceptar una prop nueva `shared` y usar la URL/headers correctos al cargar la portada. Reemplazar la firma y el bloque de `fetch` dentro del `useEffect`:

```jsx
export default function BookCard({ book, selectionMode, selected, onActivate, shared = false }) {
```

Dentro del `useEffect`, reemplazar la rama que hace `fetch(bookCoverUrl(...))`:

```jsx
      try {
        const url = shared ? sharedCoverUrl(book.id) : bookCoverUrl(book.id);
        const headers = shared ? {} : { Authorization: `Bearer ${getToken()}` };
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const blob = await res.blob();
        putCover(book.id, blob).catch(() => {});
        show(blob);
      } catch { /* offline or other failure — silent */ }
```

Añadir la insignia 🔗 dentro del `<div className={styles.cover} ...>` (junto a las otras insignias, tras `book.isOffline`):

```jsx
        {book.shared ? (
          <span className={styles.sharedBadge} title="Compartido" aria-label="Compartido">🔗</span>
        ) : null}
```

- [ ] **Step 2: Estilo de la insignia**

En `client/src/library/library.module.css`, añadir:

```css
.sharedBadge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: rgba(16, 32, 96, 0.85);
  color: #fff;
  border-radius: 6px;
  padding: 1px 5px;
  font-size: 0.8rem;
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build:client`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add client/src/library/BookCard.jsx client/src/library/library.module.css
git commit -m "feat(client): BookCard shared badge and public cover fetch"
```

---

## Task 12: `Toolbar` — botones Compartir / Dejar de compartir

**Files:**
- Modify: `client/src/library/Toolbar.jsx`

- [ ] **Step 1: Añadir las acciones de compartir al modo selección**

En `client/src/library/Toolbar.jsx`, ampliar la firma del componente y añadir los botones en la rama `selectionMode`:

```jsx
export default function Toolbar({
  query, onQueryChange,
  selectionMode, selectedCount,
  onAddFile,
  onEnterSelection, onCancelSelection, onDeleteSelected,
  onShareSelected, onUnshareSelected,
  uploading,
}) {
```

En la rama `selectionMode` (el segundo `<>...</>`), antes del botón "Cancelar", añadir:

```jsx
            <button
              className={styles.btn}
              onClick={onShareSelected}
              disabled={selectedCount === 0}
            >
              🔗 Compartir ({selectedCount})
            </button>
            <button
              className={styles.btn}
              onClick={onUnshareSelected}
              disabled={selectedCount === 0}
            >
              ✕ Dejar de compartir ({selectedCount})
            </button>
```

- [ ] **Step 2: Verificar build**

Run: `npm run build:client`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add client/src/library/Toolbar.jsx
git commit -m "feat(client): share/unshare actions in selection toolbar"
```

---

## Task 13: `SharedShelf` — sección Libros Compartidos

**Files:**
- Create: `client/src/library/SharedShelf.jsx`
- Modify: `client/src/library/library.module.css`

- [ ] **Step 1: Crear el componente de la vitrina**

Crear `client/src/library/SharedShelf.jsx`:

```jsx
import { useState } from 'react';
import styles from './library.module.css';
import BookCard from './BookCard.jsx';
import StarRating from './StarRating.jsx';
import { api } from '../lib/api.js';

// books: lista de /api/shared (ya filtrada de "mine"). canRate: hay sesión.
export default function SharedShelf({ books, canRate, onOpen }) {
  const [ratings, setRatings] = useState({}); // id -> { avgStars, ratingCount, myStars }

  const merged = (b) => ({ ...b, ...(ratings[b.id] || {}) });

  const rate = async (id, stars) => {
    try { setRatings((r) => ({ ...r, [id]: await api.rateShared(id, stars) })); }
    catch (e) { console.error('[rate]', e); }
  };
  const clear = async (id) => {
    try { setRatings((r) => ({ ...r, [id]: await api.unrateShared(id) })); }
    catch (e) { console.error('[unrate]', e); }
  };

  if (books.length === 0) {
    return <p className={styles.empty}>Aún no hay libros compartidos.</p>;
  }

  return (
    <div className={styles.grid}>
      {books.map((raw) => {
        const b = merged(raw);
        return (
          <div key={b.id} className={styles.sharedItem}>
            <BookCard book={b} shared onActivate={() => onOpen(b)} />
            <p className={styles.sharedBy}>compartido por {b.sharedBy}</p>
            <StarRating
              avg={b.avgStars}
              count={b.ratingCount}
              myStars={b.myStars}
              interactive={canRate}
              onRate={(s) => rate(b.id, s)}
              onClear={() => clear(b.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Estilos**

En `client/src/library/library.module.css`, añadir:

```css
.sharedItem { display: flex; flex-direction: column; }
.sharedBy { font-size: 0.75rem; color: #6b7280; margin: 4px 0 0; }
```

- [ ] **Step 3: Verificar build**

Run: `npm run build:client`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add client/src/library/SharedShelf.jsx client/src/library/library.module.css
git commit -m "feat(client): SharedShelf section with ratings"
```

---

## Task 14: `LibraryPage` — dos secciones, modo invitado y compartir

**Files:**
- Modify: `client/src/library/LibraryPage.jsx`
- Modify: `client/src/library/library.module.css`

- [ ] **Step 1: Cargar compartidos, manejar invitado y compartir**

En `client/src/library/LibraryPage.jsx`:

a) Añadir imports:

```jsx
import GoogleSignInButton from '../auth/GoogleSignInButton.jsx';
import SharedShelf from './SharedShelf.jsx';
import loginStyles from '../auth/login.module.css';
```

b) Añadir estado para compartidos y derivar si hay sesión. Tras la línea `const [offline, setOffline] = useState(false);` añadir:

```jsx
  const [shared, setShared] = useState([]);
  const isGuest = !user;
```

c) En `reload`, sólo pedir los libros propios si hay sesión, y siempre cargar compartidos. Reemplazar el cuerpo del `try { const list = await api.listBooks(); ... }` para envolver la carga propia:

```jsx
    try {
      if (user) {
        const list = await api.listBooks();
        setBooks(enrich(list));
        saveCachedLibrary(list);
      } else {
        setBooks([]);
      }
      setOffline(false);
      setError(null);
    } catch (e) {
      const cached = getCachedLibrary();
      if (cached?.books?.length) {
        setBooks(enrich(cached.books));
        setOffline(true);
        setError(null);
      } else if (!silent) {
        setError(e.message);
      }
    } finally {
      if (!silent) setLoading(false);
    }
    try {
      const sh = await api.listShared();
      setShared(sh.filter((b) => !b.mine));
    } catch { /* sin red: vitrina vacía */ }
```

Añadir `user` a las dependencias del `useCallback(reload, [...])` (cambiar `[]` por `[user]`).

d) Añadir handlers de compartir tras `deleteSelected`:

```jsx
  const shareSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await api.shareBooks(ids);
      setBooks((prev) => prev.map(b => selectedIds.has(b.id) ? { ...b, shared: 1 } : b));
      cancelSelection();
      reload({ silent: true });
    } catch (e) { alert('Error al compartir: ' + e.message); }
  };
  const unshareSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await api.unshareBooks(ids);
      setBooks((prev) => prev.map(b => selectedIds.has(b.id) ? { ...b, shared: 0 } : b));
      cancelSelection();
      reload({ silent: true });
    } catch (e) { alert('Error al dejar de compartir: ' + e.message); }
  };
```

e) En `onActivate`, distinguir compartidos (esta función queda para Mis Libros; los compartidos usan su propio handler en el render):

```jsx
  const openShared = (book) => navigate(`/read/${book.id}?shared=1`);
```

- [ ] **Step 2: Reestructurar el render en dos secciones**

Reemplazar el `return (...)` de `LibraryPage` por la estructura de dos secciones. El header queda igual salvo que los controles de usuario sólo se muestran con sesión:

```jsx
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <img src="/favicon.svg" alt="" className={styles.logo} width="32" height="32" />
          <h1 className={styles.title}>MisLibros</h1>
        </div>
        {!isGuest && (
          <div className={styles.userBox}>
            {!Capacitor.isNativePlatform() && (
              <FullscreenButton className={styles.iconBtn} isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
            )}
            <button className={styles.iconBtn} onClick={() => setSettingsOpen(true)}
              aria-label="Ajustes del lector" title="Ajustes del lector">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <Avatar user={user} className={styles.avatar} />
            <button className={styles.logoutBtn} onClick={logout}>Salir</button>
          </div>
        )}
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Mis Libros</h2>
        {isGuest ? (
          <div className={styles.guestCard}>
            <p className={styles.guestLead}>Inicia sesión para subir y leer tus propios libros.</p>
            <GoogleSignInButton className={loginStyles.btnSlot} nativeClassName={loginStyles.nativeBtn} />
          </div>
        ) : (
          <>
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
              onShareSelected={shareSelected}
              onUnshareSelected={unshareSelected}
            />
            {offline && (
              <div className={styles.offlineBanner}>Modo offline — viendo libros guardados localmente</div>
            )}
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
              <div className={viewMode === 'list' ? styles.list : styles.grid}>
                {filtered.map((b) => (
                  <BookCard key={b.id} book={b} selectionMode={selectionMode}
                    selected={selectedIds.has(b.id)} onActivate={onActivate} />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Libros Compartidos</h2>
        <SharedShelf books={sharedFiltered} canRate={!isGuest} onOpen={openShared} />
      </section>

      <SettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); setViewMode(loadSettings().viewMode); }} />

      <hr className={styles.divider} />
      <PitchSection />
    </main>
  );
```

Añadir un `useMemo` para filtrar la vitrina por la misma búsqueda (tras el `filtered` existente):

```jsx
  const sharedFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shared;
    return shared.filter(b =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q)
    );
  }, [shared, query]);
```

- [ ] **Step 3: Estilos de secciones y tarjeta de invitado**

En `client/src/library/library.module.css`, añadir:

```css
.section { margin-top: 18px; }
.sectionTitle { font-size: 1.15rem; font-weight: 700; margin: 0 0 10px; color: #1a2340; }
.guestCard {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 28px 18px; border: 1px dashed #c9ccd4; border-radius: 12px; text-align: center;
}
.guestLead { margin: 0; color: #4b5563; }
```

- [ ] **Step 4: Verificar build**

Run: `npm run build:client`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add client/src/library/LibraryPage.jsx client/src/library/library.module.css
git commit -m "feat(client): two-section library with guest mode and sharing"
```

---

## Task 15: `ReaderPage` — modo compartido (público, progreso local, sin anotaciones)

**Files:**
- Modify: `client/src/reader/ReaderPage.jsx`

- [ ] **Step 1: Detectar el modo compartido**

En `client/src/reader/ReaderPage.jsx`:

a) Cambiar imports de router y api:

```jsx
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, bookFileUrl, sharedFileUrl, getToken } from '../lib/api.js';
```

b) Tras `const { bookId } = useParams();` añadir:

```jsx
  const [searchParams] = useSearchParams();
  const isShared = searchParams.get('shared') === '1' || !getToken();
```

- [ ] **Step 2: Usar el endpoint público y progreso local en lectura compartida**

a) En la carga del archivo, reemplazar la obtención de progreso y el `fetch`:

```jsx
        let buf = await getBookFile(bookId);
        const serverProgress = isShared ? null : await api.getProgress(bookId).catch(() => null);
        const progress = serverProgress || getProgressLocal(bookId);
        if (!buf) {
          const fileRes = await fetch(
            isShared ? sharedFileUrl(bookId) : bookFileUrl(bookId),
            isShared ? {} : { headers: { Authorization: `Bearer ${getToken()}` } },
          );
          if (!fileRes.ok) throw new Error('No se pudo cargar el libro');
          buf = await fileRes.arrayBuffer();
          putBookFile(bookId, buf).catch(() => {});
        }
```

b) En el listener `relocate`, no escribir al servidor en modo compartido. Reemplazar el bloque `if (cfi) { ... }`:

```jsx
          if (cfi) {
            latestPosRef.current = { cfi, fraction: saveFraction };
            saveProgressLocal(bookId, cfi, saveFraction);
            if (!isShared && cfi !== lastSavedCfiRef.current) {
              lastSavedCfiRef.current = cfi;
              api.putProgress(bookId, cfi, saveFraction)
                .then(() => markSynced(bookId))
                .catch(() => { /* stays unsynced; flushed by useSyncQueue */ });
            }
          }
```

c) En `flush` (keepalive), no enviar al servidor en modo compartido:

```jsx
        const flush = () => {
          const pos = latestPosRef.current;
          if (!pos || isShared) return;
          api.putProgressKeepalive(bookId, pos.cfi, pos.fraction);
        };
```

d) En la carga de anotaciones, saltarla en modo compartido. Envolver el bloque `try { const list = await api.listAnnotations(bookId); ... }`:

```jsx
        if (!isShared) {
          try {
            const list = await api.listAnnotations(bookId);
            if (!disposed && Array.isArray(list)) {
              setAnnotations(list);
              for (const a of list) {
                try { await view.addAnnotation({ value: a.cfi, color: a.color }); } catch {}
              }
            }
          } catch { /* offline or not yet — silent */ }
        }
```

e) Añadir `isShared` a las dependencias del `useEffect` principal de carga (cambiar `}, [bookId]);` por `}, [bookId, isShared]);`).

- [ ] **Step 3: Deshabilitar UI de anotaciones y guardado al servidor**

a) En `goBack`, no escribir progreso al servidor en modo compartido:

```jsx
  const goBack = async () => {
    const pos = latestPosRef.current;
    if (pos && !isShared) {
      try { await api.putProgress(bookId, pos.cfi, pos.fraction); } catch {}
    }
    navigate('/');
  };
```

b) Ocultar el botón de modo selección y el `SelectionMenu` en modo compartido. Para el botón "★" de subrayados y el de selección: envolver su render con `{!isShared && (...)}`. En concreto:

- El botón `aria-label="Subrayados"` (★) → envolver en `{!isShared && (...)}`.
- El botón de modo selección del header (`!isNative && (...)` con el ícono de selección) → cambiar la condición a `{!isNative && !isShared && (...)}`.
- El botón central `navCenter` que activa selección → cambiar a no activar selección en modo compartido: en su `onClick`, `() => { if (!isShared) setSelectionMode((v) => !v); }`.
- El `<SelectionMenu .../>` → envolver en `{!isShared && (<SelectionMenu .../>)}`.

c) `NoteModal`, `AnnotationsDrawer` y `WiktionaryModal`: como `selection`/`annotations` nunca se poblarán en modo compartido (sin listeners de creación porque el menú está oculto y no se cargan), no necesitan cambios; quedan inertes. (La selección de texto del navegador sigue funcionando para copiar, pero sin menú de anotación.)

- [ ] **Step 4: Verificar build**

Run: `npm run build:client`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add client/src/reader/ReaderPage.jsx
git commit -m "feat(client): reader shared mode — public file, local-only progress, no annotations"
```

---

## Task 16: Verificación end-to-end (manual)

**Files:** ninguno (verificación)

- [ ] **Step 1: Suite del servidor**

Run: `npm test -w server`
Expected: PASS — toda la suite verde.

- [ ] **Step 2: Build del cliente**

Run: `npm run build:client`
Expected: build exitoso.

- [ ] **Step 3: Verificación manual (dev)**

Run: `npm run dev:server` y `npm run dev:client` (en terminales separadas).
Verificar:
- Abrir la app → cae en `/login` con botón Google + "Entrar sin iniciar sesión".
- "Entrar sin iniciar sesión" → `/`: sección "Mis Libros" muestra el botón de Google; "Libros Compartidos" lista los compartidos (estrellas en solo lectura).
- Iniciar sesión → "Mis Libros" muestra tus libros + toolbar; modo selección muestra Compartir / Dejar de compartir / Eliminar.
- Compartir un libro → aparece insignia 🔗 en Mis Libros y el libro aparece en "Libros Compartidos" para otra cuenta / invitado.
- Como usuario logueado, puntuar un libro compartido de otro → la nota y el conteo se actualizan; reordena al recargar.
- Abrir un libro compartido como invitado → lee, el progreso persiste localmente al volver, sin menú de anotaciones.

- [ ] **Step 4: Commit final (si hubo ajustes)**

```bash
git add -A
git commit -m "chore: verify shared books flow end-to-end"
```

---

## Self-Review (cobertura del spec)

- DB `shared` + `ratings` → Task 1. ✔
- `authOptional` → Task 2. ✔
- `share`/`unshare` + `shared` en listado → Task 3. ✔
- `/api/shared` listado/file/cover + orden → Task 4. ✔
- Rating PUT/DELETE + validación 1–5 + 401/404 → Tasks 4–5. ✔
- Montaje público → Task 6. ✔
- API cliente → Task 7. ✔
- Botón Google reutilizable + "Entrar sin iniciar sesión" + redirección con sesión → Task 8. ✔
- Rutas públicas `/` y `/read` → Task 9. ✔
- Estrellas (lectura/interactivo) → Task 10. ✔
- Insignia 🔗 + portada pública → Task 11. ✔
- Toolbar Compartir/Dejar de compartir → Task 12. ✔
- Vitrina con autoría y estrellas → Task 13. ✔
- Dos secciones + modo invitado + filtro de "mine" + búsqueda en ambas → Task 14. ✔
- Lector modo compartido (público, progreso local, sin anotaciones) → Task 15. ✔
- Verificación → Task 16. ✔
