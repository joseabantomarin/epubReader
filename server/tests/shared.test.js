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
    const high = insertBook(db, alice.id, { title: 'High', shared: 1 });
    const mid = insertBook(db, alice.id, { title: 'Mid', shared: 1 });
    const none = insertBook(db, alice.id, { title: 'None', shared: 1 });
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
