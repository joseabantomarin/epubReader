import { Router } from 'express';
import path from 'node:path';
import { makeKoboAuth } from '../middleware/koboAuth.js';
import { config } from '../config.js';
import { parseSyncToken, buildSyncToken, SYNC_TOKEN_HEADER } from '../kobo/syncToken.js';
import { toEpoch, toKoboTimestamp } from '../kobo/format.js';
import { ensureBookUuid, listSyncBooks, getBookByUuid } from '../kobo/library.js';
import { koboResources, getMetadata, createBookEntitlement, getReadingStateResponse } from '../kobo/serializers.js';
import { bookPath } from '../storage.js';

/**
 * Kobo sync protocol router. Mount at `/kobo/:authToken`.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dataDir
 */
export function createKoboRouter(db, dataDir) {
  const r = Router({ mergeParams: true });
  r.use(makeKoboAuth(db));
  const baseUrl = config.publicUrl;
  const SYNC_ITEM_LIMIT = 100;

  // Empty/benign responses for store + account endpoints we do not implement.
  const empty = (_req, res) => res.json({});
  r.all('/v1/user/profile', empty);
  r.all('/v1/user/loyalty/benefits', (_req, res) => res.json([]));
  r.all('/v1/user/wishlist', (_req, res) => res.json([]));
  r.all('/v1/user/recommendations', (_req, res) => res.json([]));
  r.all('/v1/analytics/gettests', (_req, res) => res.json({ Result: 'Success', TestKey: '', Tests: {} }));
  r.all(/^\/v1\/analytics\/.*/, empty);
  r.post('/v1/auth/device', empty);
  r.post('/v1/auth/refresh', empty);

  // GET /v1/initialization
  r.get('/v1/initialization', (req, res) => {
    res.set('x-kobo-apitoken', 'e30=');
    res.json({ Resources: koboResources(baseUrl, req.koboToken) });
  });

  // GET /v1/library/sync -> changelist of NewEntitlement / ChangedReadingState
  r.get('/v1/library/sync', (req, res) => {
    const userId = req.koboUserId;
    const inTok = parseSyncToken(req.get(SYNC_TOKEN_HEADER));
    // books_last_id tracks the highest book.id seen in a previous sync so that
    // books inserted within the same second as the cursor are not re-sent and
    // books inserted after the cursor are not missed.
    const lastId = inTok.books_last_id != null ? Number(inTok.books_last_id) : 0;
    const results = [];
    let maxLastId = lastId;
    let maxRs = inTok.reading_state_last_modified;
    let truncated = false;

    for (const book of listSyncBooks(db, userId)) {
      if (book.id <= lastId) continue;
      if (results.length >= SYNC_ITEM_LIMIT) { truncated = true; break; }
      const uuid = ensureBookUuid(db, book);
      results.push({
        NewEntitlement: {
          BookEntitlement: createBookEntitlement(book, uuid),
          BookMetadata: getMetadata(baseUrl, req.koboToken, book, uuid),
        },
      });
      // Advance the cursor only after a successful emit, so the book that trips
      // the page limit is re-sent on the next sync rather than skipped forever.
      maxLastId = book.id;
    }

    if (!truncated) {
      const progresses = db.prepare(`
        SELECT rp.*, b.kobo_uuid AS uuid
          FROM reading_progress rp JOIN books b ON b.id = rp.book_id
         WHERE b.user_id = ?
         ORDER BY rp.last_read_at
      `).all(userId);
      for (const p of progresses) {
        const epoch = toEpoch(p.last_read_at);
        if (!p.uuid || epoch <= inTok.reading_state_last_modified) continue;
        if (results.length >= SYNC_ITEM_LIMIT) { truncated = true; break; }
        results.push({ ChangedReadingState: { ReadingState: getReadingStateResponse(p.uuid, p) } });
        // Advance only after emit (same boundary-safety as the books loop). The
        // epoch cursor is 1-second resolution; reading states are not bulk
        // written by a device, so same-second collisions are not a concern.
        if (epoch > maxRs) maxRs = epoch;
      }
    }

    const outTok = buildSyncToken({
      ...inTok,
      books_last_id: maxLastId,
      reading_state_last_modified: maxRs,
    });
    res.set(SYNC_TOKEN_HEADER, outTok);
    if (truncated) res.set('x-kobo-sync', 'continue');
    res.json(results);
  });

  // GET /v1/library/:uuid/metadata -> [metadata]
  r.get('/v1/library/:uuid/metadata', (req, res) => {
    const book = getBookByUuid(db, req.koboUserId, req.params.uuid);
    if (!book) return res.status(404).end();
    res.json([getMetadata(baseUrl, req.koboToken, book, req.params.uuid)]);
  });

  // GET /v1/library/:uuid/state -> [ReadingState]
  r.get('/v1/library/:uuid/state', (req, res) => {
    const book = getBookByUuid(db, req.koboUserId, req.params.uuid);
    if (!book) return res.status(404).end();
    const progress = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(book.id);
    res.json([getReadingStateResponse(req.params.uuid, progress || undefined)]);
  });

  // PUT /v1/library/:uuid/state -> store device progress
  r.put('/v1/library/:uuid/state', (req, res) => {
    const book = getBookByUuid(db, req.koboUserId, req.params.uuid);
    if (!book) return res.status(404).end();
    const rs = req.body && Array.isArray(req.body.ReadingStates) ? req.body.ReadingStates[0] : null;
    if (!rs || typeof rs !== 'object') return res.status(400).json({ error: 'bad_request' });

    const bm = rs.CurrentBookmark || {};
    const chapterProgress = bm.ProgressPercent != null ? bm.ProgressPercent / 100 : null;
    const bookPercent = bm.ContentSourceProgressPercent != null ? bm.ContentSourceProgressPercent / 100 : null;
    const loc = bm.Location || {};
    const locValue = loc.Value ?? null;
    const locSource = loc.Source ?? null;

    const existing = db.prepare('SELECT book_id FROM reading_progress WHERE book_id = ?').get(book.id);
    if (existing) {
      db.prepare(`
        UPDATE reading_progress SET
          percentage = COALESCE(?, percentage),
          kobo_chapter_progress = COALESCE(?, kobo_chapter_progress),
          kobo_chapter_id = COALESCE(?, kobo_chapter_id),
          kobo_location_value = COALESCE(?, kobo_location_value),
          source = 'kobo',
          last_read_at = CURRENT_TIMESTAMP
        WHERE book_id = ?
      `).run(bookPercent, chapterProgress, locSource, locValue, book.id);
    } else {
      db.prepare(`
        INSERT INTO reading_progress
          (book_id, cfi, percentage, kobo_chapter_progress, kobo_chapter_id, kobo_location_value, source, last_read_at)
        VALUES (?, NULL, COALESCE(?, 0), ?, ?, ?, 'kobo', CURRENT_TIMESTAMP)
      `).run(book.id, bookPercent, chapterProgress, locSource, locValue);
    }

    const now = toKoboTimestamp(new Date());
    res.json({
      RequestResult: 'Success',
      UpdateResults: [{
        EntitlementId: req.params.uuid,
        CurrentBookmarkResult: { Result: 'Success' },
        StatusInfoResult: { Result: 'Success' },
        StatisticsResult: { Result: 'Success' },
        LastModified: now,
        PriorityTimestamp: now,
      }],
    });
  });

  // GET /download/:bookId/:format -> the stored book file (plain EPUB).
  // We deliberately serve the original EPUB, not a KEPUB: a stock Kobo reads
  // plain EPUB and stores highlight locations as CFI-shaped `#point()` paths
  // that map cleanly back to the web reader, and serving the same file keeps
  // device and web-reader DOMs byte-identical.
  r.get('/download/:bookId/:format', (req, res) => {
    const id = Number(req.params.bookId);
    if (!Number.isInteger(id)) return res.status(404).end();
    const book = db.prepare('SELECT id, format FROM books WHERE id = ? AND user_id = ?').get(id, req.koboUserId);
    if (!book) return res.status(404).end();
    const file = bookPath(dataDir, req.koboUserId, book.id, book.format || 'epub');
    res.type('application/epub+zip').sendFile(path.resolve(file));
  });

  // Cover: /:uuid/:width/:height/:isGreyscale/image.jpg (and the 5-arg quality variant)
  // These are registered LAST because the path params could shadow more specific routes above.
  function sendCover(req, res) {
    const book = getBookByUuid(db, req.koboUserId, req.params.uuid);
    if (!book || !book.cover_path) return res.status(404).end();
    res.sendFile(path.resolve(path.join(dataDir, book.cover_path)));
  }
  r.get('/:uuid/:width/:height/:isGreyscale/image.jpg', sendCover);
  r.get('/:uuid/:width/:height/:quality/:isGreyscale/image.jpg', sendCover);

  return r;
}
