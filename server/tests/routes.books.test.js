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

describe('PUT/DELETE /api/books/:id/rating (own books)', () => {
  it('rates an own book and surfaces it in the list', async () => {
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const rated = await request(app)
      .put(`/api/books/${up.body.id}/rating`)
      .set(authHeader(user))
      .send({ stars: 4 });
    expect(rated.status).toBe(200);
    expect(rated.body).toMatchObject({ myStars: 4, ratingCount: 1, avgStars: 4 });

    const list = await request(app).get('/api/books').set(authHeader(user));
    expect(list.body[0]).toMatchObject({ myStars: 4, ratingCount: 1, avgStars: 4 });
  });

  it('rejects invalid star values (400)', async () => {
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const res = await request(app)
      .put(`/api/books/${up.body.id}/rating`)
      .set(authHeader(user))
      .send({ stars: 9 });
    expect(res.status).toBe(400);
  });

  it('removes a rating', async () => {
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    await request(app).put(`/api/books/${up.body.id}/rating`).set(authHeader(user)).send({ stars: 5 });
    const cleared = await request(app).delete(`/api/books/${up.body.id}/rating`).set(authHeader(user));
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ myStars: null, ratingCount: 0, avgStars: null });
  });

  it('refuses to rate a book owned by another user (404)', async () => {
    const other = insertUser(db, { google_sub: 'other', email: 'o@e.com' });
    const up = await request(app).post('/api/books').set(authHeader(user)).attach('file', sample);
    const res = await request(app)
      .put(`/api/books/${up.body.id}/rating`)
      .set(authHeader(other))
      .send({ stars: 3 });
    expect(res.status).toBe(404);
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
