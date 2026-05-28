import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub    TEXT    UNIQUE NOT NULL,
  email         TEXT    NOT NULL,
  name          TEXT,
  picture_url   TEXT,
  created_at    TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS books (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  author        TEXT,
  cover_path    TEXT,
  file_path     TEXT    NOT NULL,
  file_size     INTEGER,
  uploaded_at   TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_books_user ON books(user_id);

CREATE TABLE IF NOT EXISTS reading_progress (
  book_id       INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  cfi           TEXT,
  percentage    REAL    DEFAULT 0,
  total_pages   INTEGER,
  last_read_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);
`;

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === column);
}

export function openDb(filePath) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Migration: add total_pages to pre-existing databases.
  if (!hasColumn(db, 'reading_progress', 'total_pages')) {
    db.exec('ALTER TABLE reading_progress ADD COLUMN total_pages INTEGER');
  }
  return db;
}
