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

describe('groups CRUD', () => {
  let db, owner, a;
  beforeEach(() => {
    db = makeDb();
    owner = insertUser(db, { email: 'owner@x.com' });
    a = app(db);
  });

  it('401 without auth', async () => {
    expect((await request(a).get('/api/groups')).status).toBe(401);
  });

  it('creates and lists my groups as owner', async () => {
    const create = await request(a).post('/api/groups').set(authHeader(owner)).send({ name: 'Familia' });
    expect(create.status).toBe(200);
    expect(create.body).toMatchObject({ name: 'Familia', role: 'owner', memberCount: 0 });

    const list = await request(a).get('/api/groups').set(authHeader(owner));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ name: 'Familia', role: 'owner' });
  });

  it('400 on empty name', async () => {
    const res = await request(a).post('/api/groups').set(authHeader(owner)).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('rename/delete only by owner', async () => {
    const other = insertUser(db, { email: 'b@x.com' });
    const gid = (await request(a).post('/api/groups').set(authHeader(owner)).send({ name: 'G' })).body.id;
    expect((await request(a).patch(`/api/groups/${gid}`).set(authHeader(other)).send({ name: 'X' })).status).toBe(403);
    expect((await request(a).patch(`/api/groups/${gid}`).set(authHeader(owner)).send({ name: 'Nuevo' })).status).toBe(200);
    expect((await request(a).delete(`/api/groups/${gid}`).set(authHeader(other))).status).toBe(403);
    expect((await request(a).delete(`/api/groups/${gid}`).set(authHeader(owner))).status).toBe(200);
    expect((await request(a).get('/api/groups').set(authHeader(owner))).body).toHaveLength(0);
  });
});
