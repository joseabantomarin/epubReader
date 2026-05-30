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

  it('blocks sharing a book whose title+author duplicates one already shared', async () => {
    const aliceBook = insertBook(db, alice.id, 'Dune');
    const bobBook = insertBook(db, bob.id, 'Dune');
    await request(a).post('/api/books/share').set(authHeader(alice)).send({ ids: [aliceBook] });
    const res = await request(a).post('/api/books/share').set(authHeader(bob)).send({ ids: [bobBook] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.blocked).toHaveLength(1);
    expect(res.body.blocked[0]).toMatchObject({ id: bobBook, title: 'Dune' });
    expect(db.prepare('SELECT shared FROM books WHERE id = ?').get(bobBook).shared).toBe(0);
  });

  it('includes the shared field in the listing', async () => {
    const mine = insertBook(db, alice.id);
    await request(a).post('/api/books/share').set(authHeader(alice)).send({ ids: [mine] });
    const res = await request(a).get('/api/books').set(authHeader(alice));
    expect(res.body[0]).toHaveProperty('shared', 1);
  });
});
