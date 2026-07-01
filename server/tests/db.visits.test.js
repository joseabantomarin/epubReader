import { describe, it, expect } from 'vitest';
import { makeDb } from './helpers.js';

describe('visits table', () => {
  it('exists and accepts a row with a default timestamp', () => {
    const db = makeDb();
    const info = db.prepare(
      `INSERT INTO visits (ip, country, region, city, os, path, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('1.2.3.4', 'PE', 'LIM', 'Lima', 'Windows', '/', 'UA');
    expect(Number(info.lastInsertRowid)).toBeGreaterThan(0);
    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(info.lastInsertRowid);
    expect(row).toMatchObject({ ip: '1.2.3.4', country: 'PE', os: 'Windows', path: '/' });
    expect(typeof row.created_at).toBe('string');
    expect(row.created_at.length).toBeGreaterThan(0);
  });
});
