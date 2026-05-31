import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { authRequired } from '../middleware/authRequired.js';
import { parseEpub } from '../epub/parser.js';
import { bookPath, coverPath, ensureUserDir, removeBookFiles } from '../storage.js';
import { config } from '../config.js';

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

function readMagic(filePath, n) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(n);
  try { fs.readSync(fd, buf, 0, n, 0); } finally { fs.closeSync(fd); }
  return buf;
}

function detectFormat(filePath, name = '') {
  const lower = name.toLowerCase();
  try {
    const head = readMagic(filePath, 5);
    if (head.subarray(0, 4).equals(ZIP_MAGIC) && lower.endsWith('.epub')) return 'epub';
    if (head.equals(PDF_MAGIC) && lower.endsWith('.pdf')) return 'pdf';
  } catch {}
  return null;
}

const COVER_EXTS = new Set(['jpg', 'png', 'gif', 'webp']);
function normalizeCoverExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'jpeg') return 'jpg';
  return COVER_EXTS.has(e) ? e : 'jpg';
}

export function createBooksRouter(db, dataDir) {
  const r = Router();
  r.use(authRequired);

  const upload = multer({
    dest: path.join(dataDir, 'tmp'),
    limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  });
  fs.mkdirSync(path.join(dataDir, 'tmp'), { recursive: true });

  // Rating summary for one of the user's books (same shape as /api/shared).
  function ratingSummary(bookId, userId) {
    const agg = db.prepare(
      'SELECT COUNT(*) AS c, AVG(stars) AS avg FROM ratings WHERE book_id = ?'
    ).get(bookId);
    const mine = db.prepare(
      'SELECT stars FROM ratings WHERE book_id = ? AND user_id = ?'
    ).get(bookId, userId);
    return {
      avgStars: agg.avg != null ? Number(agg.avg) : null,
      ratingCount: agg.c,
      myStars: mine ? mine.stars : null,
    };
  }

  r.get('/', (req, res) => {
    const userId = req.user.sub;
    const rows = db.prepare(`
      SELECT b.id, b.title, b.author, b.cover_path, b.uploaded_at, b.format, b.shared,
             b.visibility, b.share_group_id, b.share_user_id,
             b.censored, b.censor_reason,
             COALESCE(p.percentage, 0) AS percentage,
             p.last_read_at AS last_read_at,
             COUNT(rt.stars) AS rating_count,
             AVG(rt.stars) AS avg_stars,
             mr.stars AS my_stars
        FROM books b
        LEFT JOIN reading_progress p ON p.book_id = b.id
        LEFT JOIN ratings rt ON rt.book_id = b.id
        LEFT JOIN ratings mr ON mr.book_id = b.id AND mr.user_id = ?
       WHERE b.user_id = ?
       GROUP BY b.id
       ORDER BY COALESCE(p.last_read_at, b.uploaded_at) DESC
    `).all(userId, userId);
    res.json(rows.map(row => ({
      id: row.id,
      title: row.title,
      author: row.author,
      format: row.format,
      shared: row.shared,
      visibility: row.visibility,
      shareGroupId: row.share_group_id,
      shareUserId: row.share_user_id,
      censored: !!row.censored,
      censorReason: row.censor_reason || null,
      coverUrl: row.cover_path ? `/api/books/${row.id}/cover` : null,
      percentage: row.percentage,
      lastReadAt: row.last_read_at,
      avgStars: row.avg_stars != null ? Number(row.avg_stars) : null,
      ratingCount: row.rating_count,
      myStars: row.my_stars != null ? row.my_stars : null,
    })));
  });

  // Rate / unrate one of your own books. Reuses the shared ratings table, so a
  // rating set here also counts toward the public average if the book is shared.
  r.put('/:id/rating', (req, res) => {
    const id = Number(req.params.id);
    const stars = req.body?.stars;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'invalid_stars' });
    }
    const book = db.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').get(id, req.user.sub);
    if (!book) return res.status(404).end();
    db.prepare(`
      INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)
      ON CONFLICT(book_id, user_id) DO UPDATE SET stars = excluded.stars, updated_at = CURRENT_TIMESTAMP
    `).run(book.id, req.user.sub, stars);
    res.json(ratingSummary(book.id, req.user.sub));
  });

  r.delete('/:id/rating', (req, res) => {
    const id = Number(req.params.id);
    const book = db.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').get(id, req.user.sub);
    if (!book) return res.status(404).end();
    db.prepare('DELETE FROM ratings WHERE book_id = ? AND user_id = ?').run(book.id, req.user.sub);
    res.json(ratingSummary(book.id, req.user.sub));
  });

  const uploadFields = upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]);

  r.post('/', uploadFields, async (req, res) => {
    const fileEntry = req.files?.file?.[0];
    const coverEntry = req.files?.cover?.[0];
    if (!fileEntry) return res.status(400).json({ error: 'missing_file' });

    const tmpPath = fileEntry.path;
    const tmpCoverPath = coverEntry?.path;
    const originalName = fileEntry.originalname || 'book';
    const cleanup = () => {
      try { fs.unlinkSync(tmpPath); } catch {}
      if (tmpCoverPath) try { fs.unlinkSync(tmpCoverPath); } catch {}
    };

    const format = detectFormat(tmpPath, originalName);
    if (!format) {
      cleanup();
      return res.status(400).json({ error: 'unsupported_format' });
    }

    // EPUB: parse server-side. PDF: trust client-provided title/author/cover.
    let title = null, author = null, cover = null;
    if (format === 'epub') {
      try {
        const meta = parseEpub(tmpPath);
        title = meta.title; author = meta.author;
        if (meta.cover) cover = { data: meta.cover.data, ext: meta.cover.ext };
      } catch { /* keep nulls */ }
    } else {
      title = (req.body.title || '').trim() || null;
      author = (req.body.author || '').trim() || null;
      if (coverEntry) {
        const ext = (coverEntry.mimetype || '').split('/')[1];
        cover = { path: tmpCoverPath, ext };
      }
    }

    const fallbackName = originalName.replace(/\.(epub|pdf)$/i, '');
    const finalTitle = title || fallbackName;
    const stat = fs.statSync(tmpPath);
    const userId = req.user.sub;
    ensureUserDir(dataDir, userId);

    const info = db.prepare(`
      INSERT INTO books (user_id, title, author, cover_path, file_path, file_size, format)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, finalTitle, author, null, 'pending', stat.size, format);
    const bookId = info.lastInsertRowid;

    try {
      const finalBook = bookPath(dataDir, userId, bookId, format);
      fs.renameSync(tmpPath, finalBook);

      let coverRel = null;
      if (cover) {
        const ext = normalizeCoverExt(cover.ext);
        const finalCover = coverPath(dataDir, userId, bookId, ext);
        if (cover.data) fs.writeFileSync(finalCover, cover.data);
        else if (cover.path) fs.renameSync(cover.path, finalCover);
        coverRel = path.relative(dataDir, finalCover);
      }
      db.prepare('UPDATE books SET file_path = ?, cover_path = ? WHERE id = ?')
        .run(path.relative(dataDir, finalBook), coverRel, bookId);

      res.json({
        id: bookId,
        title: finalTitle,
        author,
        format,
        coverUrl: coverRel ? `/api/books/${bookId}/cover` : null,
        percentage: 0,
        lastReadAt: null,
      });
    } catch (err) {
      db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
      cleanup();
      return res.status(500).json({ error: 'storage_failure' });
    }
  });

  r.delete('/', (req, res) => {
    const userId = req.user.sub;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
    if (ids.length === 0) return res.json({ deleted: 0 });

    const placeholders = ids.map(() => '?').join(',');
    const owned = db.prepare(
      `SELECT id FROM books WHERE user_id = ? AND id IN (${placeholders})`
    ).all(userId, ...ids);

    const deleteStmt = db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?');
    let deleted = 0;
    for (const row of owned) {
      const result = deleteStmt.run(row.id, userId);
      if (result.changes > 0) {
        removeBookFiles(dataDir, userId, row.id);
        deleted += 1;
      }
    }
    res.json({ deleted });
  });

  // Mark a set of owned books public, applying the duplicate-block rule.
  function sharePublic(userId, ids) {
    const placeholders = ids.map(() => '?').join(',');
    const owned = db.prepare(
      `SELECT id, title, author FROM books WHERE user_id = ? AND id IN (${placeholders})`
    ).all(userId, ...ids);
    const dupStmt = db.prepare(`
      SELECT 1 FROM books
       WHERE visibility = 'public' AND censored = 0 AND id <> ?
         AND LOWER(TRIM(title)) = LOWER(TRIM(?))
         AND LOWER(TRIM(IFNULL(author, ''))) = LOWER(TRIM(IFNULL(?, '')))
       LIMIT 1
    `);
    const blocked = [];
    const toShare = [];
    for (const b of owned) {
      const isPublicDup = db.prepare("SELECT visibility FROM books WHERE id = ?").get(b.id).visibility === 'public';
      if (isPublicDup || !!dupStmt.get(b.id, b.title, b.author)) {
        blocked.push({ id: b.id, title: b.title, author: b.author });
      } else toShare.push(b.id);
    }
    let updated = 0;
    if (toShare.length) {
      const ph = toShare.map(() => '?').join(',');
      updated = db.prepare(
        `UPDATE books SET visibility='public', shared=1, share_group_id=NULL, share_user_id=NULL
          WHERE user_id = ? AND id IN (${ph})`
      ).run(userId, ...toShare).changes;
    }
    return { updated, blocked };
  }

  r.post('/share', (req, res) => {
    const userId = req.user.sub;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
    const visibility = req.body?.visibility;
    if (ids.length === 0) return res.json({ updated: 0, blocked: [] });
    const placeholders = ids.map(() => '?').join(',');

    if (visibility === 'public') {
      return res.json(sharePublic(userId, ids));
    }

    if (visibility === 'group') {
      const groupId = Number(req.body?.targetId);
      const g = db.prepare('SELECT owner_id FROM groups WHERE id = ?').get(groupId);
      if (!g) return res.status(404).json({ error: 'group_not_found' });
      if (g.owner_id !== userId) return res.status(403).json({ error: 'forbidden' });
      const updated = db.prepare(
        `UPDATE books SET visibility='group', share_group_id=?, share_user_id=NULL, shared=0
          WHERE user_id = ? AND id IN (${placeholders})`
      ).run(groupId, userId, ...ids).changes;
      return res.json({ updated, blocked: [] });
    }

    if (visibility === 'user') {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const target = email ? db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email) : null;
      if (!target) return res.status(404).json({ error: 'user_not_found' });
      const updated = db.prepare(
        `UPDATE books SET visibility='user', share_user_id=?, share_group_id=NULL, shared=0
          WHERE user_id = ? AND id IN (${placeholders})`
      ).run(target.id, userId, ...ids).changes;
      return res.json({ updated, blocked: [] });
    }

    return res.status(400).json({ error: 'invalid_visibility' });
  });

  r.post('/unshare', (req, res) => {
    const userId = req.user.sub;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
    if (ids.length === 0) return res.json({ updated: 0, blocked: [] });
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(
      `UPDATE books SET visibility='private', shared=0, share_group_id=NULL, share_user_id=NULL
        WHERE user_id = ? AND id IN (${placeholders})`
    ).run(userId, ...ids);
    res.json({ updated: result.changes, blocked: [] });
  });

  function getOwnedBook(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const row = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(id, req.user.sub);
    if (!row) { res.status(404).end(); return null; }
    return row;
  }

  r.get('/:id/file', (req, res) => {
    const book = getOwnedBook(req, res);
    if (!book) return;
    const format = book.format || 'epub';
    const file = bookPath(dataDir, req.user.sub, book.id, format);
    const mime = format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
    res.type(mime).sendFile(file);
  });

  r.get('/:id/cover', (req, res) => {
    const book = getOwnedBook(req, res);
    if (!book) return;
    if (!book.cover_path) return res.status(404).end();
    res.sendFile(path.join(dataDir, book.cover_path));
  });

  return r;
}
