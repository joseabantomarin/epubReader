import { describe, it, expect } from 'vitest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice, findUserIdByToken, touchDevice, listDevices, deleteDevice } from '../src/kobo/devices.js';

describe('kobo/devices', () => {
  it('creates a device with a 32-hex token and resolves it to the user', () => {
    const db = makeDb();
    const user = insertUser(db);
    const dev = createDevice(db, user.id, 'My Libra');
    expect(dev.token).toMatch(/^[0-9a-f]{32}$/);
    expect(findUserIdByToken(db, dev.token)).toBe(user.id);
    expect(findUserIdByToken(db, 'nope')).toBe(null);
  });

  it('touchDevice sets last_seen_at', () => {
    const db = makeDb();
    const user = insertUser(db);
    const dev = createDevice(db, user.id);
    touchDevice(db, dev.token);
    const row = db.prepare('SELECT last_seen_at FROM kobo_devices WHERE token = ?').get(dev.token);
    expect(row.last_seen_at).toBeTruthy();
  });

  it('lists and deletes only the owner\'s devices', () => {
    const db = makeDb();
    const a = insertUser(db);
    const b = insertUser(db, { google_sub: 'b', email: 'b@e.com' });
    const devA = createDevice(db, a.id);
    createDevice(db, b.id);
    expect(listDevices(db, a.id)).toHaveLength(1);
    expect(deleteDevice(db, b.id, devA.id)).toBe(0); // not owner
    expect(deleteDevice(db, a.id, devA.id)).toBe(1);
    expect(listDevices(db, a.id)).toHaveLength(0);
  });
});
