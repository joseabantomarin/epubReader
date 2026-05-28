import express from 'express';
import { openDb } from '../src/db.js';
import { signJwt } from '../src/auth.js';

process.env.NODE_ENV = 'test';

export function makeDb() {
  return openDb(':memory:');
}

export function insertUser(db, overrides = {}) {
  const u = {
    google_sub: 'sub-' + Math.random().toString(36).slice(2),
    email: 'user@example.com',
    name: 'Test User',
    picture_url: null,
    ...overrides,
  };
  const id = db.prepare(
    'INSERT INTO users (google_sub, email, name, picture_url) VALUES (?, ?, ?, ?)'
  ).run(u.google_sub, u.email, u.name, u.picture_url).lastInsertRowid;
  return { id, ...u };
}

export function tokenFor(user) {
  return signJwt({ sub: user.id, email: user.email });
}

export function authHeader(user) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

export function jsonApp() {
  const app = express();
  app.use(express.json());
  return app;
}
