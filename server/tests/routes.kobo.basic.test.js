import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { ensureBookUuid } from '../src/kobo/library.js';
import { createKoboRouter } from '../src/routes/kobo.js';
import { ensureUserDir, bookPath } from '../src/storage.js';

let db, user, token, tmp, app, bookId;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kobo-'));
  db = makeDb();
  user = insertUser(db);
  token = createDevice(db, user.id).token;
  bookId = db.prepare("INSERT INTO books (user_id, title, file_path, file_size, format) VALUES (?, 'Dune', 'p', 10, 'epub')").run(user.id).lastInsertRowid;
  // Give the book a kobo_uuid so metadata/cover routes can resolve it.
  ensureBookUuid(db, db.prepare('SELECT * FROM books WHERE id = ?').get(bookId));
  ensureUserDir(tmp, user.id);
  fs.writeFileSync(bookPath(tmp, user.id, bookId, 'epub'), 'EPUBBYTES');
  app = express();
  app.use(express.json());
  app.use('/kobo/:authToken', createKoboRouter(db, tmp));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('kobo basic routes', () => {
  it('initialization returns Resources pointing at us', async () => {
    const res = await request(app).get(`/kobo/${token}/v1/initialization`);
    expect(res.status).toBe(200);
    expect(res.body.Resources.library_sync).toContain(`/kobo/${token}/v1/library/sync`);
  });

  it('unknown token is rejected', async () => {
    const res = await request(app).get('/kobo/bad/v1/initialization');
    expect(res.status).toBe(401);
  });

  it('download serves the stored epub bytes', async () => {
    const res = await request(app).get(`/kobo/${token}/download/${bookId}/epub`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('EPUBBYTES');
  });

  it('stub endpoints return empty 200', async () => {
    const res = await request(app).get(`/kobo/${token}/v1/user/profile`);
    expect(res.status).toBe(200);
  });
});
