import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { makeDb, insertUser } from './helpers.js';
import { openDb } from '../src/db.js';

describe('schema: groups + visibility', () => {
  it('creates groups and group_members tables', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'owner@x.com' });
    const g = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)')
      .run(owner.id, 'Familia');
    expect(g.changes).toBe(1);
    const m = db.prepare(
      'INSERT INTO group_members (group_id, user_id, email) VALUES (?, ?, ?)'
    ).run(g.lastInsertRowid, owner.id, 'm@x.com');
    expect(m.changes).toBe(1);
  });

  it('books has visibility + share target columns defaulting to private', () => {
    const db = makeDb();
    const u = insertUser(db);
    const id = db.prepare(
      "INSERT INTO books (user_id, title, file_path) VALUES (?, 'T', 'p')"
    ).run(u.id).lastInsertRowid;
    const row = db.prepare('SELECT visibility, share_group_id, share_user_id FROM books WHERE id = ?').get(id);
    expect(row.visibility).toBe('private');
    expect(row.share_group_id).toBeNull();
    expect(row.share_user_id).toBeNull();
  });

  it('backfills visibility=public for pre-existing shared books on migration', () => {
    // Simulate a legacy DB on disk: a `books` row marked shared=1 that predates
    // the visibility column, then open it via openDb() so the migration runs.
    const file = path.join(os.tmpdir(), `mislibros-migrate-test-${process.pid}.db`);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, google_sub TEXT, email TEXT, name TEXT, picture_url TEXT, created_at TEXT);
      CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, file_path TEXT, shared INTEGER NOT NULL DEFAULT 0);
    `);
    legacy.prepare("INSERT INTO users (email) VALUES ('o@x.com')").run();
    legacy.prepare("INSERT INTO books (user_id, title, file_path, shared) VALUES (1, 'Legacy', 'p', 1)").run();
    legacy.close();

    const db = openDb(file); // runs migrations incl. the visibility backfill
    const row = db.prepare('SELECT visibility FROM books WHERE id = 1').get();
    expect(row.visibility).toBe('public');
    db.close();
    for (const f of [file, `${file}-wal`, `${file}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  });
});
