import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { authRequired } from '../middleware/authRequired.js';
import { parseEpub } from '../epub/parser.js';
import { bookPath, coverPath, ensureUserDir, removeBookFiles } from '../storage.js';
import { config } from '../config.js';

const MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

function isZip(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.equals(MAGIC);
  } catch { return false; }
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
      SELECT b.id, b.title, b.author, b.cover_path, b.uploaded_at,
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
      coverUrl: row.cover_path ? `/api/books/${row.id}/cover` : null,
      percentage: row.percentage,
      lastReadAt: row.last_read_at,
    })));
  });

  r.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'missing_file' });
    const tmpPath = req.file.path;
    const originalName = req.file.originalname || 'book.epub';

    const cleanup = () => { try { fs.unlinkSync(tmpPath); } catch {} };

    if (!originalName.toLowerCase().endsWith('.epub') || !isZip(tmpPath)) {
      cleanup();
      return res.status(400).json({ error: 'not_an_epub' });
    }

    let meta = { title: null, author: null, cover: null };
    try { meta = parseEpub(tmpPath); } catch { /* keep nulls */ }

    const title = meta.title || originalName.replace(/\.epub$/i, '');
    const stat = fs.statSync(tmpPath);

    const userId = req.user.sub;
    ensureUserDir(dataDir, userId);

    const info = db.prepare(`
      INSERT INTO books (user_id, title, author, cover_path, file_path, file_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, title, meta.author, null, 'pending', stat.size);
    const bookId = info.lastInsertRowid;
    try {
      const finalEpub = bookPath(dataDir, req.user.sub, bookId);
      fs.renameSync(tmpPath, finalEpub);

      let coverRel = null;
      if (meta.cover) {
        const RAW_EXT = (meta.cover.ext === 'jpeg' ? 'jpg' : meta.cover.ext) || 'jpg';
        const ALLOWED = new Set(['jpg', 'png', 'gif', 'webp']);
        const ext = ALLOWED.has(RAW_EXT.toLowerCase()) ? RAW_EXT.toLowerCase() : 'jpg';
        const finalCover = coverPath(dataDir, req.user.sub, bookId, ext);
        fs.writeFileSync(finalCover, meta.cover.data);
        coverRel = path.relative(dataDir, finalCover);
      }
      db.prepare('UPDATE books SET file_path = ?, cover_path = ? WHERE id = ?')
        .run(path.relative(dataDir, finalEpub), coverRel, bookId);

      res.json({
        id: bookId,
        title,
        author: meta.author,
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
    const file = bookPath(dataDir, req.user.sub, book.id);
    res.type('application/epub+zip').sendFile(file);
  });

  r.get('/:id/cover', (req, res) => {
    const book = getOwnedBook(req, res);
    if (!book) return;
    if (!book.cover_path) return res.status(404).end();
    res.sendFile(path.join(dataDir, book.cover_path));
  });

  return r;
}
