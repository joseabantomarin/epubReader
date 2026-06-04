import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';
import { ensureBookUuid, listSyncBooks, getBookByUuid } from '../src/kobo/library.js';

function insertBook(db, userId, title) {
  return db.prepare(
    "INSERT INTO books (user_id, title, file_path, format) VALUES (?, ?, 'x', 'epub')"
  ).run(userId, title).lastInsertRowid;
}

describe('kobo/library', () => {
  it('assigns a stable UUID once', () => {
    const db = makeDb();
    const user = insertUser(db);
    const id = insertBook(db, user.id, 'Book');
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    const uuid1 = ensureBookUuid(db, book);
    expect(uuid1).toMatch(/^[0-9a-f-]{36}$/);
    const book2 = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    expect(ensureBookUuid(db, book2)).toBe(uuid1); // stable
  });

  it('lists books for a user and finds one by uuid', () => {
    const db = makeDb();
    const user = insertUser(db);
    const id = insertBook(db, user.id, 'Book');
    const uuid = ensureBookUuid(db, db.prepare('SELECT * FROM books WHERE id = ?').get(id));
    expect(listSyncBooks(db, user.id)).toHaveLength(1);
    expect(getBookByUuid(db, user.id, uuid).id).toBe(id);
    expect(getBookByUuid(db, user.id, 'missing')).toBeUndefined();
  });
});
