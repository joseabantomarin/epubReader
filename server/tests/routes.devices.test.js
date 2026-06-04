import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createDevicesRouter } from '../src/routes/devices.js';

let db, user, app;
beforeEach(() => {
  db = makeDb();
  user = insertUser(db);
  app = express();
  app.use(express.json());
  app.use('/api/devices', createDevicesRouter(db));
});

describe('devices routes', () => {
  it('creates a device and returns the api_endpoint', async () => {
    const res = await request(app).post('/api/devices').set(authHeader(user)).send({ name: 'Libra' });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[0-9a-f]{32}$/);
    expect(res.body.apiEndpoint).toContain(`/kobo/${res.body.token}`);
  });

  it('lists then deletes a device', async () => {
    const created = await request(app).post('/api/devices').set(authHeader(user)).send({});
    const list = await request(app).get('/api/devices').set(authHeader(user));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].apiEndpoint).toContain('/kobo/');
    const del = await request(app).delete(`/api/devices/${created.body.id}`).set(authHeader(user));
    expect(del.status).toBe(200);
    const after = await request(app).get('/api/devices').set(authHeader(user));
    expect(after.body).toHaveLength(0);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/devices');
    expect(res.status).toBe(401);
  });
});
