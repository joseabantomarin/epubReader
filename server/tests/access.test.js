import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';
import { canAccessBook } from '../src/access.js';

function makeBook(db, userId, overrides = {}) {
  const cols = { title: 'T', file_path: 'p', visibility: 'private',
    share_group_id: null, share_user_id: null, censored: 0, ...overrides };
  const id = db.prepare(`INSERT INTO books
    (user_id, title, file_path, visibility, share_group_id, share_user_id, censored, shared)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    userId, cols.title, cols.file_path, cols.visibility,
    cols.share_group_id, cols.share_user_id, cols.censored,
    cols.visibility === 'public' ? 1 : 0,
  ).lastInsertRowid;
  return db.prepare('SELECT * FROM books WHERE id = ?').get(id);
}

describe('canAccessBook', () => {
  it('owner always has access', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'o@x.com' });
    const b = makeBook(db, owner.id, { visibility: 'private' });
    expect(canAccessBook(db, b, owner.id)).toBe(true);
  });

  it('public is visible to anyone, but not when censored', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'o@x.com' });
    const other = insertUser(db, { email: 'b@x.com' });
    expect(canAccessBook(db, makeBook(db, owner.id, { visibility: 'public' }), other.id)).toBe(true);
    expect(canAccessBook(db, makeBook(db, owner.id, { visibility: 'public' }), null)).toBe(true);
    const censored = makeBook(db, owner.id, { visibility: 'public', censored: 1 });
    expect(canAccessBook(db, censored, other.id)).toBe(false);
    expect(canAccessBook(db, censored, owner.id)).toBe(true); // owner keeps access
  });

  it('group books require active membership', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'o@x.com' });
    const member = insertUser(db, { email: 'm@x.com' });
    const outsider = insertUser(db, { email: 'x@x.com' });
    const gid = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(owner.id, 'G').lastInsertRowid;
    db.prepare('INSERT INTO group_members (group_id, user_id, email) VALUES (?, ?, ?)')
      .run(gid, member.id, 'm@x.com');
    const b = makeBook(db, owner.id, { visibility: 'group', share_group_id: gid });
    expect(canAccessBook(db, b, member.id)).toBe(true);
    expect(canAccessBook(db, b, owner.id)).toBe(true);
    expect(canAccessBook(db, b, outsider.id)).toBe(false);
  });

  it('user (individual) books are visible only to the target and owner', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'o@x.com' });
    const target = insertUser(db, { email: 't@x.com' });
    const other = insertUser(db, { email: 'z@x.com' });
    const b = makeBook(db, owner.id, { visibility: 'user', share_user_id: target.id });
    expect(canAccessBook(db, b, target.id)).toBe(true);
    expect(canAccessBook(db, b, owner.id)).toBe(true);
    expect(canAccessBook(db, b, other.id)).toBe(false);
  });
});
