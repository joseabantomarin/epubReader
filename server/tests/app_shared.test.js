import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeDb } from './helpers.js';
import { createApp } from '../src/app.js';

process.env.NODE_ENV = 'test';

describe('app mounts /api/shared publicly', () => {
  it('returns an array without authentication', async () => {
    const app = createApp({ db: makeDb(), dataDir: '/tmp/test-data' });
    const res = await request(app).get('/api/shared');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
