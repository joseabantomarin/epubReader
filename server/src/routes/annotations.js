import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';

export function createAnnotationsRouter(db) {
  const r = Router({ mergeParams: true });
  r.use(authRequired);

  function ownedBook(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const row = db.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').get(id, req.user.sub);
    if (!row) { res.status(404).end(); return null; }
    return row;
  }

  r.get('/:id/annotations', (req, res) => {
    const book = ownedBook(req, res);
    if (!book) return;
    const rows = db.prepare(`
      SELECT id, cfi, text, note, color, created_at, updated_at
      FROM annotations WHERE book_id = ?
      ORDER BY id ASC
    `).all(book.id);
    res.json(rows.map(r => ({
      id: r.id, cfi: r.cfi, text: r.text, note: r.note, color: r.color,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })));
  });

  r.post('/:id/annotations', (req, res) => {
    const { cfi, text = '', note = '', color = '#ffd400' } = req.body || {};
    if (typeof cfi !== 'string' || !cfi.trim()) return res.status(400).json({ error: 'invalid_cfi' });
    const book = ownedBook(req, res);
    if (!book) return;
    const result = db.prepare(`
      INSERT INTO annotations (book_id, user_id, cfi, text, note, color)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(book.id, req.user.sub, cfi, String(text || ''), String(note || ''), String(color || '#ffd400'));
    const row = db.prepare(`
      SELECT id, cfi, text, note, color, created_at, updated_at FROM annotations WHERE id = ?
    `).get(result.lastInsertRowid);
    res.json({
      id: row.id, cfi: row.cfi, text: row.text, note: row.note, color: row.color,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
  });

  r.patch('/:id/annotations/:annId', (req, res) => {
    const book = ownedBook(req, res);
    if (!book) return;
    const annId = Number(req.params.annId);
    if (!Number.isInteger(annId)) return res.status(404).end();
    const { note, color } = req.body || {};
    const fields = [];
    const values = [];
    if (typeof note === 'string') { fields.push('note = ?'); values.push(note); }
    if (typeof color === 'string') { fields.push('color = ?'); values.push(color); }
    if (fields.length === 0) return res.json({ ok: true });
    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(annId, book.id);
    const result = db.prepare(
      `UPDATE annotations SET ${fields.join(', ')} WHERE id = ? AND book_id = ?`
    ).run(...values);
    if (result.changes === 0) return res.status(404).end();
    res.json({ ok: true });
  });

  r.delete('/:id/annotations/:annId', (req, res) => {
    const book = ownedBook(req, res);
    if (!book) return;
    const annId = Number(req.params.annId);
    if (!Number.isInteger(annId)) return res.status(404).end();
    const result = db.prepare(
      'DELETE FROM annotations WHERE id = ? AND book_id = ?'
    ).run(annId, book.id);
    if (result.changes === 0) return res.status(404).end();
    res.json({ ok: true });
  });

  return r;
}
