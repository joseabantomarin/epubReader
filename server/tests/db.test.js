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

  it('adds a shared column to books (default 0)', () => {
    const cols = db.prepare('PRAGMA table_info(books)').all().map(c => c.name);
    expect(cols).toContain('shared');
    const userId = db.prepare('INSERT INTO users (google_sub, email) VALUES (?, ?)').run('s2', 'c@d.com').lastInsertRowid;
    db.prepare('INSERT INTO books (user_id, title, file_path) VALUES (?, ?, ?)').run(userId, 'T', 'p');
    const row = db.prepare('SELECT shared FROM books LIMIT 1').get();
    expect(row.shared).toBe(0);
  });

  it('creates a ratings table with a 1..5 check and cascade on book delete', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('ratings');

    const userId = db.prepare('INSERT INTO users (google_sub, email) VALUES (?, ?)').run('s3', 'e@f.com').lastInsertRowid;
    const bookId = db.prepare('INSERT INTO books (user_id, title, file_path) VALUES (?, ?, ?)').run(userId, 'T', 'p').lastInsertRowid;
    db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(bookId, userId, 5);
    expect(() => db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(bookId, userId, 9)).toThrow();

    db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM ratings').get();
    expect(remaining.c).toBe(0);
  });
});
