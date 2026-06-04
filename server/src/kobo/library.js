import crypto from 'node:crypto';

/**
 * Return the book's Kobo UUID, generating and persisting one on first use.
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: number, kobo_uuid?: string|null }} book
 * @returns {string}
 */
export function ensureBookUuid(db, book) {
  if (book.kobo_uuid) return book.kobo_uuid;
  const uuid = crypto.randomUUID();
  db.prepare('UPDATE books SET kobo_uuid = ? WHERE id = ?').run(uuid, book.id);
  return uuid;
}

/** @param {import('better-sqlite3').Database} db @param {number} userId */
export function listSyncBooks(db, userId) {
  return db.prepare('SELECT * FROM books WHERE user_id = ? ORDER BY id').all(userId);
}

/** @param {import('better-sqlite3').Database} db @param {number} userId @param {string} uuid */
export function getBookByUuid(db, userId, uuid) {
  return db.prepare('SELECT * FROM books WHERE kobo_uuid = ? AND user_id = ?').get(uuid, userId);
}
