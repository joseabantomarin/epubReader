import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createGroupsRouter } from '../src/routes/groups.js';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/groups', createGroupsRouter(db));
  return a;
}

describe('group members', () => {
  let db, owner, a, gid;
  beforeEach(async () => {
    db = makeDb();
    owner = insertUser(db, { email: 'owner@x.com' });
    a = app(db);
    gid = (await request(a).post('/api/groups').set(authHeader(owner)).send({ name: 'G' })).body.id;
  });

  it('adds a registered user as active member', async () => {
    insertUser(db, { email: 'reg@x.com' });
    const res = await request(a).post(`/api/groups/${gid}/members`)
      .set(authHeader(owner)).send({ email: 'REG@x.com' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'reg@x.com', status: 'active' });
  });

  it('adds an unregistered email as pending', async () => {
    const res = await request(a).post(`/api/groups/${gid}/members`)
      .set(authHeader(owner)).send({ email: 'ghost@x.com' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'ghost@x.com', status: 'pending' });
  });

  it('409 on duplicate member', async () => {
    await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'a@x.com' });
    const dup = await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'a@x.com' });
    expect(dup.status).toBe(409);
  });

  it('only owner can add members', async () => {
    const other = insertUser(db, { email: 'b@x.com' });
    const res = await request(a).post(`/api/groups/${gid}/members`).set(authHeader(other)).send({ email: 'c@x.com' });
    expect(res.status).toBe(403);
  });

  it('group detail lists members and reports role', async () => {
    await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'm@x.com' });
    const res = await request(a).get(`/api/groups/${gid}`).set(authHeader(owner));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('owner');
    expect(res.body.members.map(m => m.email)).toContain('m@x.com');
    expect(Array.isArray(res.body.books)).toBe(true);
  });

  it('removes a member (owner) and lets a member leave', async () => {
    const member = insertUser(db, { email: 'm@x.com' });
    const add = await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'm@x.com' });
    const memberId = add.body.id;
    expect((await request(a).get(`/api/groups/${gid}`).set(authHeader(member))).status).toBe(200);
    expect((await request(a).post(`/api/groups/${gid}/leave`).set(authHeader(member))).status).toBe(200);
    const add2 = await request(a).post(`/api/groups/${gid}/members`).set(authHeader(owner)).send({ email: 'm@x.com' });
    expect((await request(a).delete(`/api/groups/${gid}/members/${add2.body.id}`).set(authHeader(owner))).status).toBe(200);
    expect((await request(a).get(`/api/groups/${gid}`).set(authHeader(owner))).body.members).toHaveLength(0);
  });

  it('non-members cannot read group detail', async () => {
    const outsider = insertUser(db, { email: 'z@x.com' });
    expect((await request(a).get(`/api/groups/${gid}`).set(authHeader(outsider))).status).toBe(404);
  });
});
