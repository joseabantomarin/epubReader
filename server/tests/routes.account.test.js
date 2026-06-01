import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeDb, insertUser, authHeader } from './helpers.js';

process.env.NODE_ENV = 'test';

let tmp, app, db, user;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'er-acct-'));
  db = makeDb();
  user = insertUser(db, { email: 'me@example.com' });
  app = createApp({ db, dataDir: tmp });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function insertBook(db, userId, overrides = {}) {
  const b = {
    title: 'T', author: null, file_path: 'p', format: 'epub',
    shared: 0, visibility: 'private', share_group_id: null, share_user_id: null,
    ...overrides,
  };
  return db.prepare(`
    INSERT INTO books (user_id, title, author, file_path, format, shared, visibility, share_group_id, share_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, b.title, b.author, b.file_path, b.format, b.shared, b.visibility, b.share_group_id, b.share_user_id).lastInsertRowid;
}

describe('DELETE /api/auth/account', () => {
  it('401 without a token', async () => {
    const res = await request(app).delete('/api/auth/account').send({ email: 'me@example.com' });
    expect(res.status).toBe(401);
  });

  it('400 when email is missing', async () => {
    const res = await request(app).delete('/api/auth/account').set(authHeader(user)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_email');
  });

  it('400 when the email does not match the account', async () => {
    const res = await request(app).delete('/api/auth/account').set(authHeader(user)).send({ email: 'someone@else.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('email_mismatch');
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(user.id)).toBeTruthy();
  });

  it('matches email case-insensitively and with surrounding whitespace', async () => {
    const res = await request(app).delete('/api/auth/account').set(authHeader(user)).send({ email: '  ME@Example.com ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
  });

  it('404 when the account is already gone', async () => {
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    const res = await request(app).delete('/api/auth/account').set(authHeader(user)).send({ email: 'me@example.com' });
    expect(res.status).toBe(404);
  });

  it('deletes the user and cascade-removes their books, annotations, ratings, groups and memberships', async () => {
    const bookId = insertBook(db, user.id);
    db.prepare("INSERT INTO annotations (book_id, user_id, cfi) VALUES (?, ?, 'c')").run(bookId, user.id);
    db.prepare('INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)').run(bookId, user.id, 5);
    db.prepare('INSERT INTO reading_progress (book_id, percentage) VALUES (?, ?)').run(bookId, 0.5);
    const groupId = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(user.id, 'G').lastInsertRowid;
    db.prepare('INSERT INTO group_members (group_id, user_id, email) VALUES (?, ?, ?)').run(groupId, user.id, 'me@example.com');

    const res = await request(app).delete('/api/auth/account').set(authHeader(user)).send({ email: 'me@example.com' });
    expect(res.status).toBe(200);

    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(user.id)).toBeUndefined();
    expect(db.prepare('SELECT id FROM books WHERE id = ?').get(bookId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) c FROM annotations').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM ratings').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM reading_progress').get().c).toBe(0);
    expect(db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) c FROM group_members').get().c).toBe(0);
  });

  it('removes pending email-addressed group invitations matching the user', async () => {
    const owner = insertUser(db, { email: 'owner@example.com' });
    const groupId = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(owner.id, 'G').lastInsertRowid;
    // Pending invite addressed to the user's email, not yet linked to a user_id.
    db.prepare('INSERT INTO group_members (group_id, user_id, email) VALUES (?, NULL, ?)').run(groupId, 'ME@example.com');

    await request(app).delete('/api/auth/account').set(authHeader(user)).send({ email: 'me@example.com' });

    expect(db.prepare('SELECT COUNT(*) c FROM group_members WHERE user_id IS NULL').get().c).toBe(0);
  });

  it('unshares other users\' books that pointed at the deleted user or their groups', async () => {
    const other = insertUser(db, { email: 'other@example.com' });
    // A book another user shared directly TO the deleted user.
    const direct = insertBook(db, other.id, { visibility: 'user', shared: 0, share_user_id: user.id });
    // A book another user published into a group the deleted user owns.
    const groupId = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)').run(user.id, 'G').lastInsertRowid;
    const viaGroup = insertBook(db, other.id, { visibility: 'group', shared: 0, share_group_id: groupId });

    await request(app).delete('/api/auth/account').set(authHeader(user)).send({ email: 'me@example.com' });

    const d = db.prepare('SELECT visibility, share_user_id FROM books WHERE id = ?').get(direct);
    expect(d).toMatchObject({ visibility: 'private', share_user_id: null });
    const g = db.prepare('SELECT visibility, share_group_id FROM books WHERE id = ?').get(viaGroup);
    expect(g).toMatchObject({ visibility: 'private', share_group_id: null });
  });

  it('removes the user\'s files directory from disk', async () => {
    const userDir = path.join(tmp, 'books', String(user.id));
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, '1.epub'), 'data');

    await request(app).delete('/api/auth/account').set(authHeader(user)).send({ email: 'me@example.com' });

    expect(fs.existsSync(userDir)).toBe(false);
  });
});
