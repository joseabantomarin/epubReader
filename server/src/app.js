import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { openDb } from './db.js';
import { config } from './config.js';
import { createAuthRouter } from './routes/auth.js';
import { createBooksRouter } from './routes/books.js';
import { createProgressRouter } from './routes/progress.js';
import { createAnnotationsRouter } from './routes/annotations.js';
import { createSharedRouter } from './routes/shared.js';
import { createAIRouter } from './routes/ai.js';
import { createGroupsRouter } from './routes/groups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(options = {}) {
  const db = options.db || openDb(path.join(config.dataDir, 'library.db'));
  const dataDir = options.dataDir || config.dataDir;
  const isTest = process.env.NODE_ENV === 'test';
  const isProd = process.env.NODE_ENV === 'production';

  const app = express();
  app.set('trust proxy', 1);

  if (!isTest) {
    app.use(morgan(isProd ? 'combined' : 'dev'));
    app.use(helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
          // blob: needed so foliate-js can embed EPUB chapter content in iframes.
          'frame-src': ["'self'", 'https://accounts.google.com', 'blob:'],
          'connect-src': ["'self'", 'https://accounts.google.com', 'https://*.wiktionary.org'],
          'img-src': ["'self'", 'data:', 'https:', 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com', 'blob:'],
          'style-src-elem': ["'self'", "'unsafe-inline'", 'https://accounts.google.com', 'blob:'],
          'worker-src': ["'self'", 'blob:'],
        },
      },
      // Google Sign-In opens a popup that needs to communicate back via
      // window.opener.postMessage. The default same-origin COOP would break
      // that link as soon as the popup navigates to accounts.google.com.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }));
    if (!isProd) app.use(cors({ origin: config.clientOrigin }));
  }

  app.use(express.json({ limit: '1mb' }));
  app.locals.db = db;
  app.locals.dataDir = dataDir;

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  if (!isTest) {
    app.use('/api/auth/google', rateLimit({ windowMs: 60_000, max: 10 }));
  }
  app.use('/api/auth', createAuthRouter(db, dataDir));

  if (!isTest) {
    const uploadLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 30,
      keyGenerator: (req) => req.user?.sub ? `u:${req.user.sub}` : req.ip,
    });
    app.use((req, res, next) => {
      if (req.method === 'POST' && req.path === '/api/books') return uploadLimiter(req, res, next);
      next();
    });
  }
  app.use('/api/books', createBooksRouter(db, dataDir));
  app.use('/api/books', createProgressRouter(db));
  app.use('/api/books', createAnnotationsRouter(db));
  app.use('/api/shared', createSharedRouter(db, dataDir));
  app.use('/api/groups', createGroupsRouter(db));

  if (!isTest) {
    app.use('/api/ai', rateLimit({ windowMs: 60_000, max: 20 }));
  }
  app.use('/api/ai', createAIRouter());

  // Public downloads (e.g. Android APK). Outside the SPA dist so it survives
  // client rebuilds; served in any environment.
  const downloadsDir = path.join(dataDir, 'downloads');
  if (fs.existsSync(downloadsDir)) {
    app.use('/downloads', express.static(downloadsDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.apk')) {
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        }
      },
    }));
  }

  if (isProd) {
    const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
    }
  }

  app.use((err, _req, res, _next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'file_too_large' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
