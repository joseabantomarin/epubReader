import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { makeKoboAuth } from '../src/middleware/koboAuth.js';

function appWith(db) {
  const app = express();
  const r = express.Router({ mergeParams: true });
  r.use(makeKoboAuth(db));
  r.get('/whoami', (req, res) => res.json({ userId: req.koboUserId }));
  app.use('/kobo/:authToken', r);
  return app;
}

describe('koboAuth', () => {
  it('resolves a valid token to the user and touches last_seen', async () => {
    const db = makeDb();
    const user = insertUser(db);
    const dev = createDevice(db, user.id);
    const res = await request(appWith(db)).get(`/kobo/${dev.token}/whoami`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(user.id);
    const row = db.prepare('SELECT last_seen_at FROM kobo_devices WHERE token = ?').get(dev.token);
    expect(row.last_seen_at).toBeTruthy();
  });

  it('401s an unknown token', async () => {
    const db = makeDb();
    const res = await request(appWith(db)).get('/kobo/deadbeef/whoami');
    expect(res.status).toBe(401);
  });
});
