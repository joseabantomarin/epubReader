import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { authOptional } from '../src/middleware/authOptional.js';
import { signJwt } from '../src/auth.js';

process.env.NODE_ENV = 'test';

function app() {
  const a = express();
  a.use(express.json());
  a.use(authOptional);
  a.get('/who', (req, res) => res.json({ user: req.user }));
  return a;
}

describe('authOptional', () => {
  it('sets req.user to null when there is no token', async () => {
    const res = await request(app()).get('/who');
    expect(res.status).toBe(200);
    expect(res.body.user).toBe(null);
  });

  it('sets req.user from a valid Bearer token', async () => {
    const token = signJwt({ sub: 7, email: 'g@h.com' });
    const res = await request(app()).get('/who').set('Authorization', `Bearer ${token}`);
    expect(res.body.user.sub).toBe(7);
  });

  it('treats an invalid token as anonymous (no 401)', async () => {
    const res = await request(app()).get('/who').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(200);
    expect(res.body.user).toBe(null);
  });
});
