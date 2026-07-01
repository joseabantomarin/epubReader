import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeDb } from './helpers.js';

describe('visit tracking wired into the app', () => {
  it('logs a visit for a page load but not for /api', async () => {
    const db = makeDb();
    const app = createApp({ db, dataDir: '/tmp/test-data' });
    await request(app).get('/').set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120');
    await request(app).get('/api/health');
    const rows = db.prepare('SELECT * FROM visits').all();
    expect(rows.length).toBe(1);
    expect(rows[0].path).toBe('/');
    expect(rows[0].os).toBe('Windows');
  });
});
