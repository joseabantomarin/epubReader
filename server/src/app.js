import express from 'express';
import { openDb } from './db.js';
import { config } from './config.js';
import path from 'node:path';
import { createAuthRouter } from './routes/auth.js';

export function createApp(options = {}) {
  const db = options.db || openDb(path.join(config.dataDir, 'library.db'));
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.locals.db = db;

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter(db));

  return app;
}
