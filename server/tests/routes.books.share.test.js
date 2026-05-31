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
