import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeDb, insertUser, authHeader } from './helpers.js';

let tmp, db, app, user;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'er-'));
  db = makeDb();
  user = insertUser(db);
  app = createApp({ db, dataDir: tmp });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('kobo wired into app', () => {
  it('device API and kobo sync are reachable through createApp', async () => {
    const created = await request(app).post('/api/devices').set(authHeader(user)).send({ name: 'Libra' });
    expect(created.status).toBe(200);
    const token = created.body.token;
    const sync = await request(app).get(`/kobo/${token}/v1/library/sync`);
    expect(sync.status).toBe(200);
    expect(Array.isArray(sync.body)).toBe(true);
  });
});
