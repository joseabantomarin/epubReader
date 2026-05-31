import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createSharedRouter } from '../src/routes/shared.js';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/shared', createSharedRouter(db, '/tmp/test-data'));
  return a;
}

describe('GET /api/shared/with-me', () => {
  let db, owner, target, a;
  beforeEach(() => {
    db = makeDb();
    owner = insertUser(db, { email: 'owner@x.com' });
    target = insertUser(db, { email: 't@x.com' });
    a = app(db);
  });

  it('lists books shared individually with me', async () => {
    db.prepare(`INSERT INTO books (user_id, title, file_path, visibility, share_user_id)
                VALUES (?, 'Solo para ti', 'p', 'user', ?)`).run(owner.id, target.id);
    const res = await request(a).get('/api/shared/with-me').set(authHeader(target));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ title: 'Solo para ti', sharedBy: owner.name });
  });

  it('does not leak other people\'s individual shares', async () => {
    const other = insertUser(db, { email: 'z@x.com' });
    db.prepare(`INSERT INTO books (user_id, title, file_path, visibility, share_user_id)
                VALUES (?, 'No tuyo', 'p', 'user', ?)`).run(owner.id, other.id);
    const res = await request(a).get('/api/shared/with-me').set(authHeader(target));
    expect(res.body).toHaveLength(0);
  });

  it('requires auth', async () => {
    expect((await request(a).get('/api/shared/with-me')).status).toBe(401);
  });
});
