import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authRequired } from '../src/middleware/authRequired.js';
import { signJwt } from '../src/auth.js';

process.env.NODE_ENV = 'test';

function makeApp() {
  const app = express();
  app.get('/protected', authRequired, (req, res) => res.json({ user: req.user }));
  return app;
}

describe('authRequired', () => {
  it('rejects requests with no Authorization header (401)', async () => {
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token (401)', async () => {
    const res = await request(makeApp()).get('/protected').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('attaches req.user when token is valid', async () => {
    const token = signJwt({ sub: 7, email: 'u@e.com' });
    const res = await request(makeApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.sub).toBe(7);
    expect(res.body.user.email).toBe('u@e.com');
  });

  it('accepts a fallback token in body._t when header is absent (for sendBeacon)', async () => {
    const { signJwt } = await import('../src/auth.js');
    const token = signJwt({ sub: 99, email: 'b@e.com' });
    const app = express();
    app.use(express.json());
    app.post('/protected', authRequired, (req, res) => res.json({ user: req.user, body: req.body }));
    const res = await request(app).post('/protected').send({ _t: token, cfi: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.user.sub).toBe(99);
    expect(res.body.body).toEqual({ cfi: 'x' }); // _t stripped
  });
});
