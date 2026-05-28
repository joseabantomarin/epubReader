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
    const row = db.prepare('SELECT cfi, percentage, last_read_at FROM reading_progress WHERE book_id = ?').get(book.id);
    if (!row) return res.json({ cfi: null, percentage: 0, lastReadAt: null });
    res.json({ cfi: row.cfi, percentage: row.percentage, lastReadAt: row.last_read_at });
  });

  r.put('/:id/progress', (req, res) => {
    const { cfi, percentage } = req.body || {};
    if (typeof cfi !== 'string' || typeof percentage !== 'number' || Number.isNaN(percentage)) {
      return res.status(400).json({ error: 'invalid_body' });
    }
    const book = ownedBook(req, res);
    if (!book) return;
    db.prepare(`
      INSERT INTO reading_progress (book_id, cfi, percentage, last_read_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(book_id) DO UPDATE SET
        cfi = excluded.cfi,
        percentage = excluded.percentage,
        last_read_at = CURRENT_TIMESTAMP
    `).run(book.id, cfi, percentage);
    res.json({ ok: true });
  });

  return r;
}
