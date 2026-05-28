import express from 'express';
import path from 'node:path';
import { openDb } from './db.js';
import { config } from './config.js';
import { createAuthRouter } from './routes/auth.js';
import { createBooksRouter } from './routes/books.js';

export function createApp(options = {}) {
  const db = options.db || openDb(path.join(config.dataDir, 'library.db'));
  const dataDir = options.dataDir || config.dataDir;

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.locals.db = db;
  app.locals.dataDir = dataDir;

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/books', createBooksRouter(db, dataDir));

  return app;
}
