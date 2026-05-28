import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db.js';

describe('db.openDb', () => {
  let db;
  beforeEach(() => { db = openDb(':memory:'); });

  it('creates the schema with users, books, reading_progress tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const names = tables.map(t => t.name);
    expect(names).toContain('users');
    expect(names).toContain('books');
    expect(names).toContain('reading_progress');
  });

  it('enforces foreign keys (cascade on user delete)', () => {
    const userId = db.prepare('INSERT INTO users (google_sub, email) VALUES (?, ?)').run('s1', 'a@b.com').lastInsertRowid;
    db.prepare('INSERT INTO books (user_id, title, file_path) VALUES (?, ?, ?)').run(userId, 'T', 'p');
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM books').get();
    expect(remaining.c).toBe(0);
  });
});
