import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';
import { createDevice, listDevices, deleteDevice } from '../kobo/devices.js';
import { config } from '../config.js';

/**
 * REST router for device management (create, list, delete Kobo devices).
 * All routes require a valid JWT (authRequired).
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createDevicesRouter(db) {
  const r = Router();
  r.use(authRequired);

  const endpoint = (token) => `${config.publicUrl}/kobo/${token}`;

  r.get('/', (req, res) => {
    const rows = listDevices(db, req.user.sub).map((d) => ({
      id: d.id,
      name: d.name,
      lastSeenAt: d.last_seen_at,
      createdAt: d.created_at,
      apiEndpoint: endpoint(d.token),
    }));
    res.json(rows);
  });

  r.post('/', (req, res) => {
    const name =
      typeof req.body?.name === 'string' && req.body.name.trim()
        ? req.body.name.trim()
        : null;
    const d = createDevice(db, req.user.sub, name);
    res.json({ id: d.id, name: d.name, token: d.token, apiEndpoint: endpoint(d.token) });
  });

  r.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).end();
    if (!deleteDevice(db, req.user.sub, id)) return res.status(404).end();
    res.json({ ok: true });
  });

  return r;
}
