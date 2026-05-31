import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';
import { linkPendingMemberships } from '../src/routes/auth.js';

describe('linkPendingMemberships', () => {
  it('attaches pending group_members rows to the newly known user', () => {
    const db = makeDb();
    const owner = insertUser(db, { email: 'owner@x.com' });
    const gid = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(owner.id, 'G').lastInsertRowid;
    db.prepare('INSERT INTO group_members (group_id, user_id, email) VALUES (?, NULL, ?)')
      .run(gid, 'late@x.com');
    const u = insertUser(db, { email: 'late@x.com' });

    linkPendingMemberships(db, u.id, 'LATE@x.com'); // case-insensitive

    const row = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND email = ?')
      .get(gid, 'late@x.com');
    expect(row.user_id).toBe(u.id);
  });
});
