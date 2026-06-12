import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { createKoboRouter } from '../src/routes/kobo.js';
import { ensureUserDir, bookPath } from '../src/storage.js';
import { config } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_BIN = path.join(__dirname, 'fixtures', 'fake-kepubify.mjs');
beforeAll(() => fs.chmodSync(FAKE_BIN, 0o755));

let tmp, db, user, token, app, bookId;
const savedBin = config.kepubifyBin;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobo-dl-'));
  db = makeDb();
  user = insertUser(db);
  token = createDevice(db, user.id).token;
  bookId = db.prepare("INSERT INTO books (user_id, title, file_path, file_size, format) VALUES (?, 'Dune', 'p', 8, 'epub')").run(user.id).lastInsertRowid;
  ensureUserDir(tmp, user.id);
  fs.writeFileSync(bookPath(tmp, user.id, bookId, 'epub'), 'EPUBBYTES');
  app = express();
  app.use(express.json());
  app.use('/kobo/:authToken', createKoboRouter(db, tmp));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  config.kepubifyBin = savedBin;
});

describe('kobo kepub download', () => {
  it('serves a generated KEPUB when format=kepub', async () => {
    config.kepubifyBin = FAKE_BIN;
    const res = await request(app).get(`/kobo/${token}/download/${bookId}/kepub`);
    expect(res.status).toBe(200);
    expect(res.text.startsWith('KEPUB\n')).toBe(true);
    expect(res.text).toContain('EPUBBYTES');
    expect(fs.existsSync(bookPath(tmp, user.id, bookId, 'kepub.epub'))).toBe(true);
  });

  it('falls back to the original EPUB when kepubify fails', async () => {
    config.kepubifyBin = '/nonexistent/kepubify';
    const res = await request(app).get(`/kobo/${token}/download/${bookId}/kepub`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('EPUBBYTES');
  });

  it('still serves the raw EPUB for format=epub', async () => {
    const res = await request(app).get(`/kobo/${token}/download/${bookId}/epub`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('EPUBBYTES');
  });
});
