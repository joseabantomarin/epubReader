import crypto from 'node:crypto';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {string|null} [name]
 * @returns {{ id: number, userId: number, token: string, name: string|null }}
 */
export function createDevice(db, userId, name = null) {
  const token = crypto.randomBytes(16).toString('hex');
  const info = db.prepare(
    'INSERT INTO kobo_devices (user_id, token, name) VALUES (?, ?, ?)'
  ).run(userId, token, name);
  return { id: Number(info.lastInsertRowid), userId, token, name };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} token
 * @returns {number|null}
 */
export function findUserIdByToken(db, token) {
  const row = db.prepare('SELECT user_id FROM kobo_devices WHERE token = ?').get(token);
  return row ? row.user_id : null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} token
 */
export function touchDevice(db, token) {
  db.prepare('UPDATE kobo_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?').run(token);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @returns {Array<{ id: number, name: string|null, token: string, last_seen_at: string|null, created_at: string }>}
 */
export function listDevices(db, userId) {
  return db.prepare(
    'SELECT id, name, token, last_seen_at, created_at FROM kobo_devices WHERE user_id = ? ORDER BY id'
  ).all(userId);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {number} id
 * @returns {number} rows deleted (0 if not owner)
 */
export function deleteDevice(db, userId, id) {
  return db.prepare('DELETE FROM kobo_devices WHERE id = ? AND user_id = ?').run(id, userId).changes;
}
