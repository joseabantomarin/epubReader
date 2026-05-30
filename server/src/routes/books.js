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

  r.get('/', (req, res) => {
    const userId = req.user.sub;
    const rows = db.prepare(`
      SELECT b.id, b.title, b.author, b.cover_path, b.uploaded_at, b.format, b.shared,
             COALESCE(p.percentage, 0) AS percentage,
             p.last_read_at AS last_read_at
        FROM books b
        LEFT JOIN reading_progress p ON p.book_id = b.id
       WHERE b.user_id = ?
       ORDER BY COALESCE(p.last_read_at, b.uploaded_at) DESC
    `).all(userId);
    res.json(rows.map(row => ({
      id: row.id,
      title: row.title,
      author: row.author,
      format: row.format,
      shared: row.shared,
      coverUrl: row.cover_path ? `/api/books/${row.id}/cover` : null,
      percentage: row.percentage,
      lastReadAt: row.last_read_at,
    })));
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

  function setShared(req, res, value) {
    const userId = req.user.sub;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
    if (ids.length === 0) return res.json({ updated: 0 });
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(
      `UPDATE books SET shared = ? WHERE user_id = ? AND id IN (${placeholders})`
    ).run(value, userId, ...ids);
    res.json({ updated: result.changes });
  }

  r.post('/share', (req, res) => setShared(req, res, 1));
  r.post('/unshare', (req, res) => setShared(req, res, 0));

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
