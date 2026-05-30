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
  format        TEXT    NOT NULL DEFAULT 'epub',
  shared        INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS annotations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id       INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cfi           TEXT    NOT NULL,
  text          TEXT    NOT NULL DEFAULT '',
  note          TEXT    NOT NULL DEFAULT '',
  color         TEXT    NOT NULL DEFAULT '#ffd400',
  chapter       TEXT,
  page          INTEGER,
  created_at    TEXT    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT    DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id);

CREATE TABLE IF NOT EXISTS ratings (
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  updated_at TEXT    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (book_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_book ON ratings(book_id);
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
  // Migration: add format column to pre-existing books.
  if (!hasColumn(db, 'books', 'format')) {
    db.exec("ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'epub'");
  }
  // Migration: chapter/page snapshot fields on annotations.
  if (!hasColumn(db, 'annotations', 'chapter')) {
    db.exec("ALTER TABLE annotations ADD COLUMN chapter TEXT");
  }
  if (!hasColumn(db, 'annotations', 'page')) {
    db.exec("ALTER TABLE annotations ADD COLUMN page INTEGER");
  }
  // Migration: add shared flag to pre-existing books.
  if (!hasColumn(db, 'books', 'shared')) {
    db.exec('ALTER TABLE books ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
  }
  return db;
}
