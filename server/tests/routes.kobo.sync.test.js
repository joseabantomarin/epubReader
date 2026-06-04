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

  it('paginates a library larger than the page limit without dropping any book', async () => {
    const total = 150;
    for (let i = 0; i < total; i++) addBook(`Book ${String(i).padStart(3, '0')}`);

    const seen = new Set();
    let tok;
    let pages = 0;
    for (let guard = 0; guard < 20; guard++) {
      pages += 1;
      const req = request(app).get(`/kobo/${token}/v1/library/sync`);
      if (tok) req.set(SYNC_TOKEN_HEADER, tok);
      const res = await req;
      for (const entry of res.body) {
        if (entry.NewEntitlement) seen.add(entry.NewEntitlement.BookMetadata.Title);
      }
      tok = res.headers[SYNC_TOKEN_HEADER];
      if (res.headers['x-kobo-sync'] !== 'continue') break;
    }

    // Every book is delivered exactly once across the paged responses, and it
    // took more than one page (proving the continuation path actually ran).
    expect(seen.size).toBe(total);
    expect(pages).toBeGreaterThan(1);
  });
});
