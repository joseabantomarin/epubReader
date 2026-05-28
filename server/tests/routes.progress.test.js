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
    expect(res.body).toEqual({ cfi: null, percentage: 0, totalPages: null, lastReadAt: null });
  });

  it('PUT then GET round-trips cfi, percentage, and totalPages', async () => {
    const put = await request(app)
      .put(`/api/books/${bookId}/progress`)
      .set(authHeader(user))
      .send({ cfi: 'epubcfi(/6/4!/4/2/2)', percentage: 0.42, totalPages: 832 });
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);

    const get = await request(app).get(`/api/books/${bookId}/progress`).set(authHeader(user));
    expect(get.body.cfi).toBe('epubcfi(/6/4!/4/2/2)');
    expect(get.body.percentage).toBeCloseTo(0.42);
    expect(get.body.totalPages).toBe(832);
    expect(get.body.lastReadAt).toBeTruthy();
  });

  it('preserves totalPages when subsequent PUT omits it', async () => {
    await request(app).put(`/api/books/${bookId}/progress`).set(authHeader(user))
      .send({ cfi: 'a', percentage: 0.1, totalPages: 500 });
    await request(app).put(`/api/books/${bookId}/progress`).set(authHeader(user))
      .send({ cfi: 'b', percentage: 0.2 });
    const get = await request(app).get(`/api/books/${bookId}/progress`).set(authHeader(user));
    expect(get.body.totalPages).toBe(500);
  });

  it('PUT with only totalPages keeps existing cfi and percentage', async () => {
    await request(app).put(`/api/books/${bookId}/progress`).set(authHeader(user))
      .send({ cfi: 'precise-cfi', percentage: 0.42 });
    await request(app).put(`/api/books/${bookId}/progress`).set(authHeader(user))
      .send({ totalPages: 999 });
    const get = await request(app).get(`/api/books/${bookId}/progress`).set(authHeader(user));
    expect(get.body.cfi).toBe('precise-cfi');
    expect(get.body.percentage).toBeCloseTo(0.42);
    expect(get.body.totalPages).toBe(999);
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
