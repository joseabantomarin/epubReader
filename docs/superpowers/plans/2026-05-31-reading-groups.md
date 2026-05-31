# Grupos de lectura + visibilidad de 3 niveles — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir crear grupos de lectura, agregar miembros por email, y compartir cada libro con visibilidad exclusiva: público, grupo o individual.

**Architecture:** Backend Express + better-sqlite3: nuevas tablas `groups` y `group_members`, columnas `visibility`/`share_group_id`/`share_user_id` en `books` (con `shared` sincronizado por compatibilidad), un helper de acceso `canAccessBook`, y rutas nuevas `/api/groups` + `/api/shared-with-me`. Cliente React: pantalla "Mis grupos", diálogo de compartir con 3 niveles y estante "Compartido conmigo".

**Tech Stack:** Node + Express, better-sqlite3, vitest + supertest (server); React + Vite, react-router-dom, CSS modules (client). Capacitor para el APK.

**Spec:** `docs/superpowers/specs/2026-05-31-reading-groups-design.md`

**Build order (fases):** 1) DB → 2) Acceso + visibilidad de libros → 3) Grupos backend → 4) Vinculación de pendientes en login → 5) shared-with-me + acceso a archivo → 6) Cliente API → 7) Cliente diálogo de compartir → 8) Cliente Mis grupos → 9) Cliente Compartido conmigo → 10) Deploy.

---

## Convenciones

- Tests del servidor: `npx vitest run server/tests/<archivo> -w server` (o `npm test -w server` para todos). Patrón existente: `makeDb()`, `insertUser(db, {email})`, `authHeader(user)` de `server/tests/helpers.js`.
- Cada router se monta en un `express()` de prueba con `express.json()`.
- Commits frecuentes; mensajes en el estilo del repo (`feat(...)`, `test(...)`), terminando con la línea `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Es cambio de backend: el deploy final requiere reiniciar `epubreader.service` (lo hace Jose).

---

## Fase 1 — Migraciones de base de datos

### Task 1: Tablas `groups` / `group_members` y columnas de visibilidad en `books`

**Files:**
- Modify: `server/src/db.js`
- Test: `server/tests/db.groups.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `server/tests/db.groups.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';

describe('schema: groups + visibility', () => {
  it('creates groups and group_members tables', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'owner@x.com' });
    const g = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)')
      .run(owner.id, 'Familia');
    expect(g.changes).toBe(1);
    const m = db.prepare(
      'INSERT INTO group_members (group_id, user_id, email) VALUES (?, ?, ?)'
    ).run(g.lastInsertRowid, owner.id, 'm@x.com');
    expect(m.changes).toBe(1);
  });

  it('books has visibility + share target columns defaulting to private', () => {
    const db = makeDb();
    const u = insertUser(db);
    const id = db.prepare(
      "INSERT INTO books (user_id, title, file_path) VALUES (?, 'T', 'p')"
    ).run(u.id).lastInsertRowid;
    const row = db.prepare('SELECT visibility, share_group_id, share_user_id FROM books WHERE id = ?').get(id);
    expect(row.visibility).toBe('private');
    expect(row.share_group_id).toBeNull();
    expect(row.share_user_id).toBeNull();
  });

  it('backfills visibility=public for pre-existing shared books', () => {
    const db = makeDb();
    const u = insertUser(db);
    // Simulate a legacy shared book: insert then force shared=1, then re-run migration path.
    const id = db.prepare(
      "INSERT INTO books (user_id, title, file_path, shared) VALUES (?, 'T', 'p', 1)"
    ).run(u.id).lastInsertRowid;
    const row = db.prepare('SELECT visibility FROM books WHERE id = ?').get(id);
    expect(row.visibility).toBe('public');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/db.groups.test.js -w server`
Expected: FAIL (no such table `groups` / no column `visibility`).

- [ ] **Step 3: Implement the migration**

In `server/src/db.js`, add the two tables to the `SCHEMA` string (after the `ratings` block, before the closing backtick):

```js
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);

CREATE TABLE IF NOT EXISTS group_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT    NOT NULL,
  created_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (group_id, email)
);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_email ON group_members(email);
```

Then, inside `openDb()` after the existing `censor_reason` migration block (before `return db;`), add the column migrations + backfill:

```js
  // Migration: per-book visibility (private | public | group | user).
  if (!hasColumn(db, 'books', 'visibility')) {
    db.exec("ALTER TABLE books ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
    db.exec("UPDATE books SET visibility = 'public' WHERE shared = 1");
  }
  if (!hasColumn(db, 'books', 'share_group_id')) {
    db.exec('ALTER TABLE books ADD COLUMN share_group_id INTEGER');
  }
  if (!hasColumn(db, 'books', 'share_user_id')) {
    db.exec('ALTER TABLE books ADD COLUMN share_user_id INTEGER');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/tests/db.groups.test.js -w server`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full server suite (no regressions)**

Run: `npm test -w server`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/db.js server/tests/db.groups.test.js
git commit -m "feat(db): groups, group_members tables + book visibility columns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 2 — Helper de acceso a libros

### Task 2: `canAccessBook(db, book, userId)`

Centraliza la regla de visibilidad; lo usan el serve de archivo/cover y los listados.

**Files:**
- Create: `server/src/access.js`
- Test: `server/tests/access.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `server/tests/access.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';
import { canAccessBook } from '../src/access.js';

function makeBook(db, userId, overrides = {}) {
  const cols = { title: 'T', file_path: 'p', visibility: 'private',
    share_group_id: null, share_user_id: null, censored: 0, ...overrides };
  const id = db.prepare(`INSERT INTO books
    (user_id, title, file_path, visibility, share_group_id, share_user_id, censored, shared)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    userId, cols.title, cols.file_path, cols.visibility,
    cols.share_group_id, cols.share_user_id, cols.censored,
    cols.visibility === 'public' ? 1 : 0,
  ).lastInsertRowid;
  return db.prepare('SELECT * FROM books WHERE id = ?').get(id);
}

describe('canAccessBook', () => {
  it('owner always has access', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'o@x.com' });
    const b = makeBook(db, owner.id, { visibility: 'private' });
    expect(canAccessBook(db, b, owner.id)).toBe(true);
  });

  it('public is visible to anyone, but not when censored', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'o@x.com' });
    const other = insertUser(db, { email: 'b@x.com' });
    expect(canAccessBook(db, makeBook(db, owner.id, { visibility: 'public' }), other.id)).toBe(true);
    expect(canAccessBook(db, makeBook(db, owner.id, { visibility: 'public' }), null)).toBe(true);
    const censored = makeBook(db, owner.id, { visibility: 'public', censored: 1 });
    expect(canAccessBook(db, censored, other.id)).toBe(false);
    expect(canAccessBook(db, censored, owner.id)).toBe(true); // owner keeps access
  });

  it('group books require active membership', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'o@x.com' });
    const member = insertUser(db, { email: 'm@x.com' });
    const outsider = insertUser(db, { email: 'x@x.com' });
    const gid = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(owner.id, 'G').lastInsertRowid;
    db.prepare('INSERT INTO group_members (group_id, user_id, email) VALUES (?, ?, ?)')
      .run(gid, member.id, 'm@x.com');
    const b = makeBook(db, owner.id, { visibility: 'group', share_group_id: gid });
    expect(canAccessBook(db, b, member.id)).toBe(true);
    expect(canAccessBook(db, b, owner.id)).toBe(true);
    expect(canAccessBook(db, b, outsider.id)).toBe(false);
  });

  it('user (individual) books are visible only to the target and owner', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'o@x.com' });
    const target = insertUser(db, { email: 't@x.com' });
    const other = insertUser(db, { email: 'z@x.com' });
    const b = makeBook(db, owner.id, { visibility: 'user', share_user_id: target.id });
    expect(canAccessBook(db, b, target.id)).toBe(true);
    expect(canAccessBook(db, b, owner.id)).toBe(true);
    expect(canAccessBook(db, b, other.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/access.test.js -w server`
Expected: FAIL (cannot find `../src/access.js`).

- [ ] **Step 3: Implement the helper**

Create `server/src/access.js`:

```js
// Single source of truth for "can this user see/open this book?".
// `book` is a full row from the books table; `userId` may be null (anonymous).
export function canAccessBook(db, book, userId) {
  if (!book) return false;
  if (userId != null && book.user_id === userId) return true; // owner
  switch (book.visibility) {
    case 'public':
      return !book.censored;
    case 'group': {
      if (userId == null || !book.share_group_id) return false;
      const row = db.prepare(
        'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1'
      ).get(book.share_group_id, userId);
      return !!row;
    }
    case 'user':
      return userId != null && book.share_user_id === userId;
    default: // 'private'
      return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/tests/access.test.js -w server`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/access.js server/tests/access.test.js
git commit -m "feat(server): canAccessBook visibility helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 3 — Backend de grupos

### Task 3: Router de grupos — crear/listar/renombrar/borrar

**Files:**
- Create: `server/src/routes/groups.js`
- Modify: `server/src/app.js` (montar el router)
- Test: `server/tests/routes.groups.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes.groups.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createGroupsRouter } from '../src/routes/groups.js';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/groups', createGroupsRouter(db));
  return a;
}

describe('groups CRUD', () => {
  let db, owner, a;
  beforeEach(() => {
    db = makeDb();
    owner = insertUser(db, { email: 'owner@x.com' });
    a = app(db);
  });

  it('401 without auth', async () => {
    expect((await request(a).get('/api/groups')).status).toBe(401);
  });

  it('creates and lists my groups as owner', async () => {
    const create = await request(a).post('/api/groups').set(authHeader(owner)).send({ name: 'Familia' });
    expect(create.status).toBe(200);
    expect(create.body).toMatchObject({ name: 'Familia', role: 'owner', memberCount: 0 });

    const list = await request(a).get('/api/groups').set(authHeader(owner));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ name: 'Familia', role: 'owner' });
  });

  it('400 on empty name', async () => {
    const res = await request(a).post('/api/groups').set(authHeader(owner)).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rename/delete only by owner', async () => {
    const other = insertUser(db, { email: 'b@x.com' });
    const gid = (await request(a).post('/api/groups').set(authHeader(owner)).send({ name: 'G' })).body.id;
    expect((await request(a).patch(`/api/groups/${gid}`).set(authHeader(other)).send({ name: 'X' })).status).toBe(403);
    expect((await request(a).patch(`/api/groups/${gid}`).set(authHeader(owner)).send({ name: 'Nuevo' })).status).toBe(200);
    expect((await request(a).delete(`/api/groups/${gid}`).set(authHeader(other))).status).toBe(403);
    expect((await request(a).delete(`/api/groups/${gid}`).set(authHeader(owner))).status).toBe(200);
    expect((await request(a).get('/api/groups').set(authHeader(owner))).body).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/routes.groups.test.js -w server`
Expected: FAIL (cannot find `../src/routes/groups.js`).

- [ ] **Step 3: Implement the router (CRUD only for now)**

Create `server/src/routes/groups.js`:

```js
import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';

export function createGroupsRouter(db) {
  const r = Router();
  r.use(authRequired);

  // Returns the group row if the user is its owner, else sends 403/404 and null.
  function ownedGroup(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    if (!g) { res.status(404).end(); return null; }
    if (g.owner_id !== req.user.sub) { res.status(403).json({ error: 'forbidden' }); return null; }
    return g;
  }

  function memberCount(groupId) {
    return db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(groupId).c;
  }

  // List groups I own or am an active member of.
  r.get('/', (req, res) => {
    const uid = req.user.sub;
    const rows = db.prepare(`
      SELECT g.id, g.name, g.created_at, g.owner_id
        FROM groups g
       WHERE g.owner_id = ?
          OR g.id IN (SELECT group_id FROM group_members WHERE user_id = ?)
       ORDER BY g.created_at DESC
    `).all(uid, uid);
    res.json(rows.map(g => ({
      id: g.id,
      name: g.name,
      createdAt: g.created_at,
      role: g.owner_id === uid ? 'owner' : 'member',
      memberCount: memberCount(g.id),
    })));
  });

  r.post('/', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'missing_name' });
    const id = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)')
      .run(req.user.sub, name).lastInsertRowid;
    res.json({ id, name, role: 'owner', memberCount: 0, createdAt: null });
  });

  r.patch('/:id', (req, res) => {
    const g = ownedGroup(req, res);
    if (!g) return;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'missing_name' });
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, g.id);
    res.json({ id: g.id, name, role: 'owner', memberCount: memberCount(g.id) });
  });

  r.delete('/:id', (req, res) => {
    const g = ownedGroup(req, res);
    if (!g) return;
    // Books shared to this group revert to private.
    db.prepare("UPDATE books SET visibility='private', share_group_id=NULL, shared=0 WHERE share_group_id = ?")
      .run(g.id);
    db.prepare('DELETE FROM groups WHERE id = ?').run(g.id); // cascades group_members
    res.json({ deleted: 1 });
  });

  return r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/tests/routes.groups.test.js -w server`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount the router**

In `server/src/app.js`, add the import near the other route imports:

```js
import { createGroupsRouter } from './routes/groups.js';
```

And mount it after the `/api/shared` line (`app.use('/api/shared', ...)`):

```js
  app.use('/api/groups', createGroupsRouter(db));
```

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/groups.js server/src/app.js server/tests/routes.groups.test.js
git commit -m "feat(groups): create/list/rename/delete groups (owner-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 4: Miembros — agregar (registrado/pendiente), quitar, salir; detalle del grupo

**Files:**
- Modify: `server/src/routes/groups.js`
- Test: `server/tests/routes.groups.members.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes.groups.members.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createGroupsRouter } from '../src/routes/groups.js';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/groups', createGroupsRouter(db));
  return a;
}

describe('group members', () => {
  let db, owner, a, gid;
  beforeEach(async () => {
    db = makeDb();
    owner = insertUser(db, { email: 'owner@x.com' });
    a = app(db);
    gid = (await request(a).post('/api/groups').set(authHeader(owner)).send({ name: 'G' })).body.id;
  });

  it('adds a registered user as active member', async () => {
    insertUser(db, { email: 'reg@x.com' });
    const res = await request(a).post(`/api/groups/${gid}/members`)
      .set(authHeader(owner)).send({ email: 'REG@x.com' }); // case-insensitive
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'reg@x.com', status: 'active' });
  });

  it('adds an unregistered email as pending', async () => {
    const res = await request(a).post(`/api/groups/${gid}/members`)
      .set(authHeader(owner)).send({ email: 'ghost@x.com' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'ghost@x.com', status: 'pending' });
  });

  it('409 on duplicate member', async () => {
    await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'a@x.com' });
    const dup = await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'a@x.com' });
    expect(dup.status).toBe(409);
  });

  it('only owner can add members', async () => {
    const other = insertUser(db, { email: 'b@x.com' });
    const res = await request(a).post(`/api/groups/${gid}/members`).set(authHeader(other)).send({ email: 'c@x.com' });
    expect(res.status).toBe(403);
  });

  it('group detail lists members and reports role', async () => {
    await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'm@x.com' });
    const res = await request(a).get(`/api/groups/${gid}`).set(authHeader(owner));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('owner');
    expect(res.body.members.map(m => m.email)).toContain('m@x.com');
    expect(Array.isArray(res.body.books)).toBe(true);
  });

  it('removes a member (owner) and lets a member leave', async () => {
    const member = insertUser(db, { email: 'm@x.com' });
    const add = await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'm@x.com' });
    const memberId = add.body.id;
    // member can read detail and leave
    expect((await request(a).get(`/api/groups/${gid}`).set(authHeader(member))).status).toBe(200);
    expect((await request(a).post(`/api/groups/${gid}/leave`).set(authHeader(member))).status).toBe(200);
    // re-add then owner removes
    const add2 = await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'm@x.com' });
    expect((await request(a).delete(`/api/groups/${gid}/members/${add2.body.id}`).set(authHeader(owner))).status).toBe(200);
    expect((await request(a).get(`/api/groups/${gid}`).set(authHeader(owner))).body.members).toHaveLength(0);
  });

  it('non-members cannot read group detail', async () => {
    const outsider = insertUser(db, { email: 'z@x.com' });
    expect((await request(a).get(`/api/groups/${gid}`).set(authHeader(outsider))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/routes.groups.members.test.js -w server`
Expected: FAIL (routes 404 / not implemented).

- [ ] **Step 3: Implement members + detail**

In `server/src/routes/groups.js`, add a helper to check membership/ownership for read access, and the routes. Insert before `return r;`:

```js
  // True if the user owns the group or is an active member.
  function canSeeGroup(group, userId) {
    if (group.owner_id === userId) return true;
    const row = db.prepare(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1'
    ).get(group.id, userId);
    return !!row;
  }

  // Group detail: members (+pending) and the books shared to it.
  r.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).end();
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    if (!g || !canSeeGroup(g, req.user.sub)) return res.status(404).end();

    const members = db.prepare(`
      SELECT gm.id, gm.email, gm.user_id, u.name AS user_name
        FROM group_members gm
        LEFT JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY gm.created_at ASC
    `).all(id).map(m => ({
      id: m.id,
      email: m.email,
      name: m.user_name || null,
      status: m.user_id ? 'active' : 'pending',
    }));

    const books = db.prepare(`
      SELECT b.id, b.title, b.author, b.format, b.cover_path, u.name AS owner_name
        FROM books b JOIN users u ON u.id = b.user_id
       WHERE b.visibility = 'group' AND b.share_group_id = ?
       ORDER BY b.uploaded_at DESC
    `).all(id).map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      format: b.format,
      coverUrl: b.cover_path ? `/api/shared/${b.id}/cover` : null,
      sharedBy: b.owner_name,  // matches SharedShelf's "compartido por {sharedBy}"
    }));

    res.json({
      id: g.id,
      name: g.name,
      role: g.owner_id === req.user.sub ? 'owner' : 'member',
      members,
      books,
    });
  });

  r.post('/:id/members', (req, res) => {
    const g = ownedGroup(req, res);
    if (!g) return;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) return res.status(400).json({ error: 'missing_email' });
    const existing = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND email = ?').get(g.id, email);
    if (existing) return res.status(409).json({ error: 'already_member' });
    const user = db.prepare('SELECT id, name FROM users WHERE LOWER(email) = ?').get(email);
    const memberId = db.prepare(
      'INSERT INTO group_members (group_id, user_id, email) VALUES (?, ?, ?)'
    ).run(g.id, user ? user.id : null, email).lastInsertRowid;
    res.json({
      id: memberId,
      email,
      name: user ? user.name : null,
      status: user ? 'active' : 'pending',
    });
  });

  r.delete('/:id/members/:memberId', (req, res) => {
    const g = ownedGroup(req, res);
    if (!g) return;
    const memberId = Number(req.params.memberId);
    db.prepare('DELETE FROM group_members WHERE id = ? AND group_id = ?').run(memberId, g.id);
    res.json({ removed: 1 });
  });

  r.post('/:id/leave', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).end();
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(id, req.user.sub);
    res.json({ left: 1 });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/tests/routes.groups.members.test.js -w server`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/groups.js server/tests/routes.groups.members.test.js
git commit -m "feat(groups): add/remove/leave members + group detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 4 — Vincular miembros pendientes en el login

### Task 5: Al iniciar sesión, enlazar `group_members` pendientes por email

**Files:**
- Modify: `server/src/routes/auth.js`
- Test: `server/tests/routes.auth.pending.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes.auth.pending.test.js`. We avoid Google verification by testing the linking helper directly, so first the implementation will expose a small pure function.

```js
import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';
import { linkPendingMemberships } from '../src/routes/auth.js';

describe('linkPendingMemberships', () => {
  it('attaches pending group_members rows to the newly known user', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'owner@x.com' });
    const gid = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(owner.id, 'G').lastInsertRowid;
    // Pending invite for an email with no account yet.
    db.prepare('INSERT INTO group_members (group_id, user_id, email) VALUES (?, NULL, ?)')
      .run(gid, 'late@x.com');
    // The user signs up later.
    const u = insertUser(db, { email: 'late@x.com' });

    linkPendingMemberships(db, u.id, 'LATE@x.com'); // case-insensitive

    const row = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND email = ?')
      .get(gid, 'late@x.com');
    expect(row.user_id).toBe(u.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/routes.auth.pending.test.js -w server`
Expected: FAIL (`linkPendingMemberships` is not exported).

- [ ] **Step 3: Implement and wire it**

In `server/src/routes/auth.js`, add the exported helper at the top (after imports):

```js
// When a user logs in, attach any pending group invitations addressed to their
// email (rows inserted before they had an account).
export function linkPendingMemberships(db, userId, email) {
  db.prepare(
    'UPDATE group_members SET user_id = ? WHERE user_id IS NULL AND LOWER(email) = LOWER(?)'
  ).run(userId, email);
}
```

Then call it right before signing the JWT (after `user` is resolved in both branches), i.e. just before `const token = signJwt(...)`:

```js
    linkPendingMemberships(db, user.id, user.email);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/tests/routes.auth.pending.test.js -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/auth.js server/tests/routes.auth.pending.test.js
git commit -m "feat(auth): link pending group memberships on login

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 5 — Visibilidad de libros + acceso a archivo/cover + estante individual

### Task 6: Reescribir `share`/`unshare` con visibilidad de 3 niveles

**Files:**
- Modify: `server/src/routes/books.js`
- Test: `server/tests/routes.books.share.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes.books.share.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createBooksRouter } from '../src/routes/books.js';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/books', createBooksRouter(db, '/tmp/test-data'));
  return a;
}
function makeBook(db, userId, title = 'T') {
  return db.prepare("INSERT INTO books (user_id, title, file_path) VALUES (?, ?, 'p')")
    .run(userId, title).lastInsertRowid;
}

describe('share with visibility', () => {
  let db, owner, a;
  beforeEach(() => {
    db = makeDb();
    owner = insertUser(db, { email: 'owner@x.com' });
    a = app(db);
  });

  it('shares public (keeps shared=1 in sync)', async () => {
    const id = makeBook(db, owner.id);
    const res = await request(a).post('/api/books/share')
      .set(authHeader(owner)).send({ ids: [id], visibility: 'public' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT visibility, shared FROM books WHERE id = ?').get(id);
    expect(row).toMatchObject({ visibility: 'public', shared: 1 });
  });

  it('shares to a group I own', async () => {
    const id = makeBook(db, owner.id);
    const gid = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(owner.id, 'G').lastInsertRowid;
    const res = await request(a).post('/api/books/share')
      .set(authHeader(owner)).send({ ids: [id], visibility: 'group', targetId: gid });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT visibility, share_group_id, shared FROM books WHERE id = ?').get(id);
    expect(row).toMatchObject({ visibility: 'group', share_group_id: gid, shared: 0 });
  });

  it('rejects sharing to a group I do not own', async () => {
    const id = makeBook(db, owner.id);
    const other = insertUser(db, { email: 'b@x.com' });
    const gid = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(other.id, 'G').lastInsertRowid;
    const res = await request(a).post('/api/books/share')
      .set(authHeader(owner)).send({ ids: [id], visibility: 'group', targetId: gid });
    expect(res.status).toBe(403);
  });

  it('shares to an individual by email', async () => {
    const id = makeBook(db, owner.id);
    const target = insertUser(db, { email: 'friend@x.com' });
    const res = await request(a).post('/api/books/share')
      .set(authHeader(owner)).send({ ids: [id], visibility: 'user', email: 'FRIEND@x.com' });
    expect(res.status).toBe(200);
    const row = db.prepare('SELECT visibility, share_user_id FROM books WHERE id = ?').get(id);
    expect(row).toMatchObject({ visibility: 'user', share_user_id: target.id });
  });

  it('404 when sharing individually to an unregistered email', async () => {
    const id = makeBook(db, owner.id);
    const res = await request(a).post('/api/books/share')
      .set(authHeader(owner)).send({ ids: [id], visibility: 'user', email: 'nobody@x.com' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'user_not_found' });
  });

  it('changing visibility is exclusive (replaces previous target)', async () => {
    const id = makeBook(db, owner.id);
    const gid = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(owner.id, 'G').lastInsertRowid;
    await request(a).post('/api/books/share').set(authHeader(owner)).send({ ids: [id], visibility: 'group', targetId: gid });
    await request(a).post('/api/books/share').set(authHeader(owner)).send({ ids: [id], visibility: 'public' });
    const row = db.prepare('SELECT visibility, share_group_id, shared FROM books WHERE id = ?').get(id);
    expect(row).toMatchObject({ visibility: 'public', share_group_id: null, shared: 1 });
  });

  it('unshare returns book to private', async () => {
    const id = makeBook(db, owner.id);
    await request(a).post('/api/books/share').set(authHeader(owner)).send({ ids: [id], visibility: 'public' });
    await request(a).post('/api/books/unshare').set(authHeader(owner)).send({ ids: [id] });
    const row = db.prepare('SELECT visibility, shared FROM books WHERE id = ?').get(id);
    expect(row).toMatchObject({ visibility: 'private', shared: 0 });
  });

  it('still blocks duplicate public shares', async () => {
    const a1 = makeBook(db, owner.id, 'Dup');
    const a2 = makeBook(db, owner.id, 'Dup');
    await request(a).post('/api/books/share').set(authHeader(owner)).send({ ids: [a1], visibility: 'public' });
    const res = await request(a).post('/api/books/share').set(authHeader(owner)).send({ ids: [a2], visibility: 'public' });
    expect(res.body.blocked.map(b => b.id)).toContain(a2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/routes.books.share.test.js -w server`
Expected: FAIL (current `/share` ignores `visibility`).

- [ ] **Step 3: Replace `setShared` and the share/unshare routes**

In `server/src/routes/books.js`, replace the whole `function setShared(...) { ... }` block and the two `r.post('/share'...)`/`r.post('/unshare'...)` lines with:

```js
  // Mark a set of owned books public, applying the duplicate-block rule.
  function sharePublic(userId, ids) {
    const placeholders = ids.map(() => '?').join(',');
    const owned = db.prepare(
      `SELECT id, title, author FROM books WHERE user_id = ? AND id IN (${placeholders})`
    ).all(userId, ...ids);
    const dupStmt = db.prepare(`
      SELECT 1 FROM books
       WHERE visibility = 'public' AND censored = 0 AND id <> ?
         AND LOWER(TRIM(title)) = LOWER(TRIM(?))
         AND LOWER(TRIM(IFNULL(author, ''))) = LOWER(TRIM(IFNULL(?, '')))
       LIMIT 1
    `);
    const blocked = [];
    const toShare = [];
    for (const b of owned) {
      const isPublicDup = db.prepare("SELECT visibility FROM books WHERE id = ?").get(b.id).visibility === 'public';
      if (isPublicDup || !!dupStmt.get(b.id, b.title, b.author)) {
        blocked.push({ id: b.id, title: b.title, author: b.author });
      } else toShare.push(b.id);
    }
    let updated = 0;
    if (toShare.length) {
      const ph = toShare.map(() => '?').join(',');
      updated = db.prepare(
        `UPDATE books SET visibility='public', shared=1, share_group_id=NULL, share_user_id=NULL
          WHERE user_id = ? AND id IN (${ph})`
      ).run(userId, ...toShare).changes;
    }
    return { updated, blocked };
  }

  r.post('/share', (req, res) => {
    const userId = req.user.sub;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
    const visibility = req.body?.visibility;
    if (ids.length === 0) return res.json({ updated: 0, blocked: [] });
    const placeholders = ids.map(() => '?').join(',');

    if (visibility === 'public') {
      return res.json(sharePublic(userId, ids));
    }

    if (visibility === 'group') {
      const groupId = Number(req.body?.targetId);
      const g = db.prepare('SELECT owner_id FROM groups WHERE id = ?').get(groupId);
      if (!g) return res.status(404).json({ error: 'group_not_found' });
      if (g.owner_id !== userId) return res.status(403).json({ error: 'forbidden' });
      const updated = db.prepare(
        `UPDATE books SET visibility='group', share_group_id=?, share_user_id=NULL, shared=0
          WHERE user_id = ? AND id IN (${placeholders})`
      ).run(groupId, userId, ...ids).changes;
      return res.json({ updated, blocked: [] });
    }

    if (visibility === 'user') {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const target = email ? db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email) : null;
      if (!target) return res.status(404).json({ error: 'user_not_found' });
      const updated = db.prepare(
        `UPDATE books SET visibility='user', share_user_id=?, share_group_id=NULL, shared=0
          WHERE user_id = ? AND id IN (${placeholders})`
      ).run(target.id, userId, ...ids).changes;
      return res.json({ updated, blocked: [] });
    }

    return res.status(400).json({ error: 'invalid_visibility' });
  });

  r.post('/unshare', (req, res) => {
    const userId = req.user.sub;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
    if (ids.length === 0) return res.json({ updated: 0, blocked: [] });
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(
      `UPDATE books SET visibility='private', shared=0, share_group_id=NULL, share_user_id=NULL
        WHERE user_id = ? AND id IN (${placeholders})`
    ).run(userId, ...ids);
    res.json({ updated: result.changes, blocked: [] });
  });
```

- [ ] **Step 4: Add visibility info to `GET /api/books`**

In the `r.get('/', ...)` handler, add `b.visibility, b.share_group_id, b.share_user_id` to the SELECT column list, and add to each mapped row:

```js
      visibility: row.visibility,
      shareGroupId: row.share_group_id,
      shareUserId: row.share_user_id,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/tests/routes.books.share.test.js -w server`
Expected: PASS (8 tests).
Run: `npm test -w server`
Expected: all pass (the old `books_share.test.js` still passes because public sharing keeps `shared`/`blocked` behavior; if it asserted the old request shape `{ids}` without visibility, update those calls to `{ ids, visibility: 'public' }`).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/books.js server/tests/routes.books.share.test.js
git commit -m "feat(books): 3-level share visibility (public/group/user), exclusive

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 7: `GET /api/shared-with-me` + acceso a archivo/cover para destinatarios

**Files:**
- Modify: `server/src/routes/shared.js`
- Test: `server/tests/routes.shared_with_me.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `server/tests/routes.shared_with_me.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createSharedRouter } from '../src/routes/shared.js';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/shared', createSharedRouter(db, '/tmp/test-data'));
  return a;
}

describe('GET /api/shared-with-me', () => {
  let db, owner, target, a;
  beforeEach(() => {
    db = makeDb();
    owner = insertUser(db, { email: 'owner@x.com' });
    target = insertUser(db, { email: 't@x.com' });
    a = app(db);
  });

  it('lists books shared individually with me', async () => {
    db.prepare(`INSERT INTO books (user_id, title, file_path, visibility, share_user_id)
                VALUES (?, 'Solo para ti', 'p', 'user', ?)`).run(owner.id, target.id);
    const res = await request(a).get('/api/shared-with-me').set(authHeader(target));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ title: 'Solo para ti', sharedBy: owner.name });
  });

  it('does not leak other people\'s individual shares', async () => {
    const other = insertUser(db, { email: 'z@x.com' });
    db.prepare(`INSERT INTO books (user_id, title, file_path, visibility, share_user_id)
                VALUES (?, 'No tuyo', 'p', 'user', ?)`).run(owner.id, other.id);
    const res = await request(a).get('/api/shared-with-me').set(authHeader(target));
    expect(res.body).toHaveLength(0);
  });

  it('requires auth', async () => {
    expect((await request(a).get('/api/shared-with-me')).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tests/routes.shared_with_me.test.js -w server`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement the route + generalize file/cover access**

In `server/src/routes/shared.js`:

1. Add the import at the top:

```js
import { authRequired } from '../middleware/authRequired.js';
import { canAccessBook } from '../access.js';
```

2. Add the `shared-with-me` route (uses `authRequired`, not `authOptional`). Place it after the existing `r.get('/', ...)` listing:

```js
  r.get('/shared-with-me', authRequired, (req, res) => {
    const rows = db.prepare(`
      SELECT b.id, b.title, b.author, b.format, b.cover_path, u.name AS owner_name
        FROM books b JOIN users u ON u.id = b.user_id
       WHERE b.visibility = 'user' AND b.share_user_id = ?
       ORDER BY b.uploaded_at DESC
    `).all(req.user.sub);
    res.json(rows.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      format: b.format,
      coverUrl: b.cover_path ? `/api/shared/${b.id}/cover` : null,
      sharedBy: b.owner_name,  // matches SharedShelf's "compartido por {sharedBy}"
    })));
  });
```

> NOTE: register `/shared-with-me` BEFORE the `/:id/...` routes so it is not captured by `:id`. If `:id` routes are above, move this handler above them.

3. Generalize file/cover serving. Replace the existing `sharedBook(req, res)` (which only matched `shared = 1 AND censored = 0`) so the file/cover routes use `canAccessBook`. Change the `/:id/file` and `/:id/cover` handlers to:

```js
  function accessibleBook(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!row || !canAccessBook(db, row, req.user ? req.user.sub : null)) { res.status(404).end(); return null; }
    return row;
  }

  r.get('/:id/file', (req, res) => {
    const book = accessibleBook(req, res);
    if (!book) return;
    const format = book.format || 'epub';
    const file = bookPath(dataDir, book.user_id, book.id, format);
    const mime = format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
    res.type(mime).sendFile(file);
  });

  r.get('/:id/cover', (req, res) => {
    const book = accessibleBook(req, res);
    if (!book) return;
    if (!book.cover_path) return res.status(404).end();
    res.sendFile(path.join(dataDir, book.cover_path));
  });
```

> The listing `r.get('/', ...)` (public shelf) stays unchanged — still `WHERE shared = 1 AND censored = 0`. Only file/cover access generalizes (so group/individual recipients can open the file with their token; `authOptional` already populates `req.user` when a token is present via header or `?_t=`). Keep the existing `path` import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/tests/routes.shared_with_me.test.js -w server`
Expected: PASS (3 tests).
Run: `npm test -w server`
Expected: all pass (public file/cover access unchanged for anonymous users; censored public still 404 for non-owners via `canAccessBook`).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/shared.js server/tests/routes.shared_with_me.test.js
git commit -m "feat(shared): shared-with-me list + access-checked file/cover serving

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 6 — Cliente: métodos de API

### Task 8: Métodos de grupos y shared-with-me + `shareBooks` extendido

**Files:**
- Modify: `client/src/lib/api.js`

- [ ] **Step 1: Extend the API object**

In `client/src/lib/api.js`, change `shareBooks` and add the group/shared-with-me methods inside the `api` object:

```js
  shareBooks: (ids, visibility = 'public', extra = {}) =>
    call('/api/books/share', { method: 'POST', body: { ids, visibility, ...extra } }),
  listSharedWithMe: () => call('/api/shared-with-me'),
  listGroups: () => call('/api/groups'),
  getGroup: (id) => call(`/api/groups/${id}`),
  createGroup: (name) => call('/api/groups', { method: 'POST', body: { name } }),
  renameGroup: (id, name) => call(`/api/groups/${id}`, { method: 'PATCH', body: { name } }),
  deleteGroup: (id) => call(`/api/groups/${id}`, { method: 'DELETE' }),
  addGroupMember: (id, email) => call(`/api/groups/${id}/members`, { method: 'POST', body: { email } }),
  removeGroupMember: (id, memberId) => call(`/api/groups/${id}/members/${memberId}`, { method: 'DELETE' }),
  leaveGroup: (id) => call(`/api/groups/${id}/leave`, { method: 'POST' }),
```

> NOTE: `listSharedWithMe` calls `/api/shared-with-me`; ensure that route is registered server-side (Task 7). `BASE` prefix is applied by `call`.

- [ ] **Step 2: Verify the client still builds**

Run: `npm run build:client`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/api.js
git commit -m "feat(client): API methods for groups, shared-with-me, visibility share

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 7 — Cliente: diálogo de compartir (3 niveles)

### Task 9: `ShareDialog` y su uso en la biblioteca

**Files:**
- Create: `client/src/library/ShareDialog.jsx`
- Modify: `client/src/library/LibraryPage.jsx` (usar el diálogo en `shareSelected`)
- Reuse styles: `client/src/library/settings.module.css` (`.backdrop`, `.modal`, `.header`, `.title`, `.closeBtn`, `.body`, `.chips`, `.chip`, `.chipActive`, `.footer`, `.btnPrimary`, `.btnSecondary`)

- [ ] **Step 1: Create the dialog component**

Create `client/src/library/ShareDialog.jsx`:

```jsx
import { useEffect, useState } from 'react';
import styles from './settings.module.css';
import { api } from '../lib/api.js';

// Choose how to share the selected book(s): public, a group, or one person.
// onDone(result) is called after a successful share so the caller can refresh.
export default function ShareDialog({ open, ids = [], count, onClose, onShared }) {
  const [mode, setMode] = useState('public');
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setMode('public'); setEmail(''); setError(null); setGroupId(null);
    api.listGroups()
      .then((gs) => {
        const owned = gs.filter(g => g.role === 'owner');
        setGroups(owned);
        if (owned.length) setGroupId(owned[0].id);
      })
      .catch(() => setGroups([]));
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      let result;
      if (mode === 'public') result = await api.shareBooks(ids, 'public');
      else if (mode === 'group') {
        if (!groupId) { setError('Elige un grupo.'); setBusy(false); return; }
        result = await api.shareBooks(ids, 'group', { targetId: groupId });
      } else {
        const e = email.trim();
        if (!e) { setError('Escribe un correo.'); setBusy(false); return; }
        result = await api.shareBooks(ids, 'user', { email: e });
      }
      onShared(mode, result);
    } catch (err) {
      setError(err?.status === 404 && mode === 'user'
        ? 'Ese correo no tiene cuenta todavía.'
        : 'No se pudo compartir.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Compartir">
        <header className={styles.header}>
          <h2 className={styles.title}>Compartir {count > 1 ? `(${count})` : ''}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className={styles.body}>
          <div className={styles.chips}>
            <button className={`${styles.chip} ${mode === 'public' ? styles.chipActive : ''}`} onClick={() => setMode('public')}>Público</button>
            <button className={`${styles.chip} ${mode === 'group' ? styles.chipActive : ''}`} onClick={() => setMode('group')}>Grupo</button>
            <button className={`${styles.chip} ${mode === 'user' ? styles.chipActive : ''}`} onClick={() => setMode('user')}>Individual</button>
          </div>

          {mode === 'group' && (
            groups.length === 0
              ? <p style={{ marginTop: 12 }}>No tienes grupos propios todavía. Crea uno en “Mis grupos”.</p>
              : <select style={{ marginTop: 12, width: '100%', padding: 8 }}
                  value={groupId ?? ''} onChange={(e) => setGroupId(Number(e.target.value))}>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
          )}

          {mode === 'user' && (
            <input type="email" placeholder="correo@ejemplo.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ marginTop: 12, width: '100%', padding: 8, boxSizing: 'border-box' }} />
          )}

          {error && <p style={{ color: '#b00020', marginTop: 10 }}>{error}</p>}
        </div>
        <footer className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancelar</button>
          <button className={styles.btnPrimary} onClick={submit} disabled={busy}>
            {busy ? 'Compartiendo…' : 'Compartir'}
          </button>
        </footer>
      </div>
    </div>
  );
}
```

> The dialog receives the selected `ids` as a prop and calls `api.shareBooks(ids, mode, extra)`. `onShared(mode, result)` lets the caller refresh and surface the public duplicate-block message.

- [ ] **Step 2: Wire it into LibraryPage**

In `client/src/library/LibraryPage.jsx`:
- Import: `import ShareDialog from './ShareDialog.jsx';`
- Add state: `const [shareOpen, setShareOpen] = useState(false);`
- Change the existing `shareSelected` so instead of immediately calling `api.shareBooks(ids)` it opens the dialog: `const shareSelected = () => setShareOpen(true);`
- Render near the other modals:

```jsx
<ShareDialog
  open={shareOpen}
  ids={[...selectedIds]}
  count={selectedIds.size}
  onClose={() => setShareOpen(false)}
  onShared={(mode, result) => {
    setShareOpen(false);
    // Public shares may be blocked as duplicates — surface that as today.
    if (mode === 'public' && result?.blocked?.length) {
      // reuse existing blocked-message handling
    }
    // Refresh local state: mark shared books and clear selection.
    setBooks((prev) => prev.map(b => selectedIds.has(b.id)
      ? { ...b, shared: mode === 'public' ? 1 : 0, visibility: mode }
      : b));
    clearSelection();
  }}
/>
```

> Keep the existing duplicate "blocked" message UX used by the old `shareSelected`. The list refresh `api.listBooks()` already runs on focus; calling it here is also fine.

- [ ] **Step 3: Build to verify**

Run: `npm run build:client`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add client/src/library/ShareDialog.jsx client/src/library/LibraryPage.jsx
git commit -m "feat(library): share dialog with public/group/individual

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 8 — Cliente: pantalla "Mis grupos"

### Task 10: Rutas y pantalla de grupos (lista + detalle)

**Files:**
- Create: `client/src/groups/GroupsPage.jsx`
- Create: `client/src/groups/GroupDetailPage.jsx`
- Create: `client/src/groups/groups.module.css`
- Modify: `client/src/App.jsx` (rutas `/grupos` y `/grupos/:id`)
- Modify: `client/src/library/LibraryPage.jsx` (enlace "Mis grupos")
- Reuse: `client/src/library/SharedShelf.jsx` para mostrar los libros del grupo.

- [ ] **Step 1: Add routes in App.jsx**

In `client/src/App.jsx`, import and add routes inside `<Routes>`:

```jsx
import GroupsPage from './groups/GroupsPage.jsx';
import GroupDetailPage from './groups/GroupDetailPage.jsx';
// ...
<Route path="/grupos" element={<GroupsPage />} />
<Route path="/grupos/:groupId" element={<GroupDetailPage />} />
```

- [ ] **Step 2: Create the groups list page**

Create `client/src/groups/GroupsPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import styles from './groups.module.css';

export default function GroupsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = () => api.listGroups().then(setGroups).catch(() => setGroups([])).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    await api.createGroup(n);
    setName('');
    refresh();
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')} aria-label="Volver">←</button>
        <h1 className={styles.title}>Mis grupos</h1>
      </header>

      <div className={styles.createRow}>
        <input value={name} placeholder="Nombre del grupo" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
        <button className={styles.primary} onClick={create}>Crear</button>
      </div>

      {loading ? <p className={styles.empty}>Cargando…</p>
        : groups.length === 0 ? <p className={styles.empty}>Aún no tienes grupos.</p>
        : <ul className={styles.list}>
            {groups.map(g => (
              <li key={g.id} className={styles.item} onClick={() => navigate(`/grupos/${g.id}`)}>
                <span className={styles.name}>{g.name}</span>
                <span className={styles.meta}>
                  {g.role === 'owner' ? 'Dueño' : 'Miembro'} · {g.memberCount} miembro(s)
                </span>
              </li>
            ))}
          </ul>}
    </div>
  );
}
```

- [ ] **Step 3: Create the group detail page**

Create `client/src/groups/GroupDetailPage.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import SharedShelf from '../library/SharedShelf.jsx';
import styles from './groups.module.css';

export default function GroupDetailPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  const refresh = () => api.getGroup(groupId).then(setGroup).catch(() => navigate('/grupos'));
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [groupId]);

  if (!group) return <div className={styles.page}><p className={styles.empty}>Cargando…</p></div>;
  const isOwner = group.role === 'owner';

  const addMember = async () => {
    const e = email.trim();
    if (!e) return;
    setError(null);
    try { await api.addGroupMember(group.id, e); setEmail(''); refresh(); }
    catch (err) { setError(err?.status === 409 ? 'Ya está en el grupo.' : 'No se pudo agregar.'); }
  };
  const removeMember = async (mid) => { await api.removeGroupMember(group.id, mid); refresh(); };
  const rename = async () => {
    const n = prompt('Nuevo nombre del grupo', group.name);
    if (n && n.trim()) { await api.renameGroup(group.id, n.trim()); refresh(); }
  };
  const remove = async () => {
    if (confirm('¿Borrar este grupo? Los libros compartidos a él volverán a privados.')) {
      await api.deleteGroup(group.id); navigate('/grupos');
    }
  };
  const leave = async () => {
    if (confirm('¿Salir de este grupo?')) { await api.leaveGroup(group.id); navigate('/grupos'); }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/grupos')} aria-label="Volver">←</button>
        <h1 className={styles.title}>{group.name}</h1>
        {isOwner
          ? <div className={styles.headerActions}>
              <button className={styles.linkBtn} onClick={rename}>Renombrar</button>
              <button className={styles.dangerBtn} onClick={remove}>Borrar</button>
            </div>
          : <button className={styles.linkBtn} onClick={leave}>Salir</button>}
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Miembros</h2>
        {isOwner && (
          <div className={styles.createRow}>
            <input type="email" value={email} placeholder="correo@ejemplo.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }} />
            <button className={styles.primary} onClick={addMember}>Agregar</button>
          </div>
        )}
        {error && <p style={{ color: '#b00020' }}>{error}</p>}
        <ul className={styles.list}>
          {group.members.map(m => (
            <li key={m.id} className={styles.item}>
              <span className={styles.name}>{m.name || m.email}</span>
              <span className={styles.meta}>
                {m.status === 'pending' ? 'Pendiente' : 'Activo'}
                {isOwner && <button className={styles.linkBtn} onClick={() => removeMember(m.id)}>Quitar</button>}
              </span>
            </li>
          ))}
          {group.members.length === 0 && <p className={styles.empty}>Sin miembros aún.</p>}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Libros del grupo</h2>
        <SharedShelf books={group.books} canRate={false} onOpen={(b) => navigate(`/read/${b.id}?shared=1`)} />
      </section>
    </div>
  );
}
```

> NOTE: `SharedShelf` signature is `{ books, canRate, onOpen, isAdmin, onCensor }`. It renders "compartido por {b.sharedBy}" and a `StarRating` row. Group books carry `sharedBy` (Task 4) so the label works; pass `canRate={false}` and omit `isAdmin`/`onCensor` (ratings/censorship don't apply to group books — the star row just shows the empty state). Opening via `?shared=1` makes the reader fetch through `/api/shared/:id/file`, which now serves group members (Task 7).

- [ ] **Step 4: Create the stylesheet**

Create `client/src/groups/groups.module.css`:

```css
.page { max-width: 760px; margin: 0 auto; padding: 16px; padding-top: calc(16px + env(safe-area-inset-top)); }
.header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.back { background: transparent; border: none; font-size: 22px; cursor: pointer; color: var(--fg); }
.title { font-size: 20px; font-weight: 700; margin: 0; flex: 1; }
.headerActions { display: flex; gap: 8px; }
.createRow { display: flex; gap: 8px; margin-bottom: 14px; }
.createRow input { flex: 1; padding: 9px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--fg); }
.primary { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 9px 16px; cursor: pointer; font-weight: 600; }
.linkBtn { background: transparent; border: none; color: var(--accent); cursor: pointer; margin-left: 10px; }
.dangerBtn { background: transparent; border: 1px solid #b00020; color: #b00020; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.list { list-style: none; padding: 0; margin: 0; }
.item { display: flex; align-items: center; justify-content: space-between; padding: 12px 4px; border-bottom: 1px solid var(--border); cursor: pointer; }
.name { font-weight: 600; }
.meta { color: var(--muted); font-size: 13px; display: flex; align-items: center; }
.section { margin-top: 22px; }
.sectionTitle { font-size: 16px; font-weight: 700; margin: 0 0 10px; }
.empty { color: var(--muted); text-align: center; padding: 20px; }
```

- [ ] **Step 5: Add a "Mis grupos" entry on the home**

In `client/src/library/LibraryPage.jsx`, add a navigation button near the top of the page (e.g., in the header/toolbar area) for logged-in users:

```jsx
{!isGuest && (
  <button className={styles.iconBtn} onClick={() => navigate('/grupos')} title="Mis grupos">
    Mis grupos
  </button>
)}
```

> Place it consistently with the existing header actions (reuse a button style already present in `library.module.css`, e.g. `styles.iconBtn`). `isGuest` already exists in LibraryPage.

- [ ] **Step 6: Build to verify**

Run: `npm run build:client`
Expected: `✓ built`.

- [ ] **Step 7: Commit**

```bash
git add client/src/groups client/src/App.jsx client/src/library/LibraryPage.jsx
git commit -m "feat(client): Mis grupos screens (list + detail, members, group books)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 9 — Cliente: "Compartido conmigo"

### Task 11: Sección "Compartido conmigo" en el inicio

**Files:**
- Modify: `client/src/library/LibraryPage.jsx`
- Reuse: `client/src/library/SharedShelf.jsx`

- [ ] **Step 1: Load and render the section**

In `client/src/library/LibraryPage.jsx`:
- Add state: `const [sharedWithMe, setSharedWithMe] = useState([]);`
- In the existing data-loading effect (where `api.listShared()` is called), add for logged-in users:

```js
if (!isGuest) {
  api.listSharedWithMe().then(setSharedWithMe).catch(() => setSharedWithMe([]));
}
```

- Render a new section below the shared shelf, only when there is content:

```jsx
{!isGuest && sharedWithMe.length > 0 && (
  <section className={styles.section}>
    <h2 className={styles.sectionTitle}>Compartido conmigo</h2>
    <SharedShelf books={sharedWithMe} canRate={false}
      onOpen={(b) => navigate(`/read/${b.id}?shared=1`)} />
  </section>
)}
```

> The books carry `sharedBy` (Task 7), which `SharedShelf` shows as "compartido por …". Opening via `?shared=1` routes the file fetch through `/api/shared/:id/file` (access-checked in Task 7).

- [ ] **Step 2: Build to verify**

Run: `npm run build:client`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add client/src/library/LibraryPage.jsx
git commit -m "feat(library): 'Compartido conmigo' section for individual shares

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Fase 10 — Verificación final y despliegue

### Task 12: Suite completa, build y despliegue

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: server + client suites pass (ningún test roto).

- [ ] **Step 2: Build the web client**

Run: `npm run build:client`
Expected: `✓ built`.

- [ ] **Step 3: Deploy web + reiniciar backend**

```bash
git push
ssh administrator@147.93.176.249 'cd ~/epubReader && git pull && cd client && npm run build'
```

Backend changed (DB migration + new routes) → **Jose** ejecuta:

```bash
sudo systemctl restart epubreader
```

Verificar: `curl -s -o /dev/null -w "%{http_code}\n" https://mislibros.openlinks.app/api/health` → 200; y `curl -s https://mislibros.openlinks.app/api/shared` → JSON.

Respaldo previo recomendado (lo hace Jose): `cp server/data/library.db server/data/library.db.bak-groups`.

- [ ] **Step 4: Build + subir el APK** (proceso de `OPS.md`: parchear `.env` con `VITE_API_BASE` absoluto, `npm run build`, `npx cap sync android`, `gradlew assembleRelease` con Java 21, verificar URL en bundle, `scp`, restaurar `.env`).

- [ ] **Step 5: Smoke test manual**

- Crear un grupo, agregar un email registrado (activo) y uno no registrado (pendiente).
- Compartir un libro a ese grupo → el miembro lo ve en "Mis grupos → grupo".
- Compartir individual a un correo registrado → aparece en "Compartido conmigo" del destinatario y puede abrirlo.
- Compartir individual a correo no registrado → mensaje "no tiene cuenta".
- Cambiar visibilidad (grupo → público) → sale del grupo y entra al estante público.
- Borrar grupo → sus libros vuelven a privados.

---

## Notas de cierre

- **Backend restart obligatorio** tras el deploy (migración + rutas).
- Las **calificaciones/censura** siguen ligadas a libros públicos; no se tocan para grupo/individual.
- Si en pruebas el lector de un libro de grupo/individual no carga el archivo, verificar que la petición lleva el token (header `Authorization` o `?_t=`) — `authOptional` en `/api/shared` lo soporta.
