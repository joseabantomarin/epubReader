import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { makeDb } from './helpers.js';
import { createApp } from '../src/app.js';

process.env.NODE_ENV = 'test';

vi.mock('../src/auth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyGoogleIdToken: vi.fn(),
  };
});
import { verifyGoogleIdToken } from '../src/auth.js';

describe('POST /api/auth/google', () => {
  let app, db;
  beforeEach(() => {
    db = makeDb();
    app = createApp({ db });
    verifyGoogleIdToken.mockReset();
  });

  it('400 when credential is missing', async () => {
    const res = await request(app).post('/api/auth/google').send({});
    expect(res.status).toBe(400);
  });

  it('401 when Google rejects the token', async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(new Error('bad'));
    const res = await request(app).post('/api/auth/google').send({ credential: 'x' });
    expect(res.status).toBe(401);
  });

  it('creates a user on first login and returns a JWT', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({
      sub: 'google-sub-1', email: 'a@b.com', name: 'A', picture: 'http://p',
    });
    const res = await request(app).post('/api/auth/google').send({ credential: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('a@b.com');
    const row = db.prepare('SELECT * FROM users WHERE google_sub = ?').get('google-sub-1');
    expect(row).toBeTruthy();
  });

  it('reuses the existing user on subsequent logins', async () => {
    verifyGoogleIdToken.mockResolvedValue({
      sub: 'google-sub-2', email: 'a@b.com', name: 'A', picture: null,
    });
    await request(app).post('/api/auth/google').send({ credential: 'x' });
    await request(app).post('/api/auth/google').send({ credential: 'x' });
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    expect(count).toBe(1);
  });
});
