import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';

export function createProgressRouter(db) {
  const r = Router({ mergeParams: true });
  r.use(authRequired);

  function ownedBook(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const row = db.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').get(id, req.user.sub);
    if (!row) { res.status(404).end(); return null; }
    return row;
  }

  r.get('/:id/progress', (req, res) => {
    const book = ownedBook(req, res);
    if (!book) return;
    const row = db.prepare(
      'SELECT cfi, percentage, total_pages, last_read_at FROM reading_progress WHERE book_id = ?'
    ).get(book.id);
    if (!row) return res.json({ cfi: null, percentage: 0, totalPages: null, lastReadAt: null });
    res.json({
      cfi: row.cfi,
      percentage: row.percentage,
      totalPages: row.total_pages,
      lastReadAt: row.last_read_at,
    });
  });

  r.put('/:id/progress', (req, res) => {
    const { cfi, percentage, totalPages } = req.body || {};
    if (cfi !== undefined && cfi !== null && typeof cfi !== 'string') {
      return res.status(400).json({ error: 'invalid_cfi' });
    }
    if (percentage !== undefined && percentage !== null
        && (typeof percentage !== 'number' || Number.isNaN(percentage))) {
      return res.status(400).json({ error: 'invalid_percentage' });
    }
    if (totalPages !== undefined && totalPages !== null
        && (!Number.isInteger(totalPages) || totalPages < 0)) {
      return res.status(400).json({ error: 'invalid_total_pages' });
    }
    const book = ownedBook(req, res);
    if (!book) return;
    // Existing row? If yes, we can update fields selectively (cfi may be null).
    const existing = db.prepare('SELECT cfi FROM reading_progress WHERE book_id = ?').get(book.id);
    if (existing) {
      db.prepare(`
        UPDATE reading_progress SET
          cfi = COALESCE(?, cfi),
          percentage = COALESCE(?, percentage),
          total_pages = COALESCE(?, total_pages),
          last_read_at = CURRENT_TIMESTAMP
        WHERE book_id = ?
      `).run(cfi ?? null, percentage ?? null, totalPages ?? null, book.id);
    } else {
      // First-time row requires cfi.
      if (typeof cfi !== 'string') return res.status(400).json({ error: 'missing_cfi' });
      db.prepare(`
        INSERT INTO reading_progress (book_id, cfi, percentage, total_pages, last_read_at)
        VALUES (?, ?, COALESCE(?, 0), ?, CURRENT_TIMESTAMP)
      `).run(book.id, cfi, percentage ?? null, totalPages ?? null);
    }
    res.json({ ok: true });
  });

  return r;
}
