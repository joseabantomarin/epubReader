import { Router } from 'express';
import path from 'node:path';
import { authOptional } from '../middleware/authOptional.js';
import { bookPath } from '../storage.js';

export function createSharedRouter(db, dataDir) {
  const r = Router();
  r.use(authOptional);

  function aggregate(bookId, userId) {
    const agg = db.prepare(
      'SELECT COUNT(*) AS c, AVG(stars) AS avg FROM ratings WHERE book_id = ?'
    ).get(bookId);
    const mine = userId != null
      ? db.prepare('SELECT stars FROM ratings WHERE book_id = ? AND user_id = ?').get(bookId, userId)
      : null;
    return {
      avgStars: agg.avg != null ? Number(agg.avg) : null,
      ratingCount: agg.c,
      myStars: mine ? mine.stars : null,
    };
  }

  function sharedBook(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const row = db.prepare('SELECT * FROM books WHERE id = ? AND shared = 1').get(id);
    if (!row) { res.status(404).end(); return null; }
    return row;
  }

  r.get('/', (req, res) => {
    const me = req.user ? req.user.sub : -1;
    const rows = db.prepare(`
      SELECT b.id, b.title, b.author, b.format, b.cover_path, b.uploaded_at, b.user_id,
             u.name AS owner_name, u.email AS owner_email,
             COUNT(rt.stars) AS rating_count,
             AVG(rt.stars) AS avg_stars,
             mr.stars AS my_stars
        FROM books b
        JOIN users u ON u.id = b.user_id
        LEFT JOIN ratings rt ON rt.book_id = b.id
        LEFT JOIN ratings mr ON mr.book_id = b.id AND mr.user_id = ?
       WHERE b.shared = 1
       GROUP BY b.id
       ORDER BY (COUNT(rt.stars) = 0), AVG(rt.stars) DESC, COUNT(rt.stars) DESC, b.uploaded_at DESC
    `).all(me);

    res.json(rows.map(row => ({
      id: row.id,
      title: row.title,
      author: row.author,
      format: row.format,
      coverUrl: row.cover_path ? `/api/shared/${row.id}/cover` : null,
      sharedBy: row.owner_name || row.owner_email,
      mine: req.user ? row.user_id === req.user.sub : false,
      avgStars: row.avg_stars != null ? Number(row.avg_stars) : null,
      ratingCount: row.rating_count,
      myStars: row.my_stars != null ? row.my_stars : null,
    })));
  });

  r.get('/:id/file', (req, res) => {
    const book = sharedBook(req, res);
    if (!book) return;
    const format = book.format || 'epub';
    const file = bookPath(dataDir, book.user_id, book.id, format);
    const mime = format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
    res.type(mime).sendFile(file);
  });

  r.get('/:id/cover', (req, res) => {
    const book = sharedBook(req, res);
    if (!book) return;
    if (!book.cover_path) return res.status(404).end();
    res.sendFile(path.join(dataDir, book.cover_path));
  });

  r.put('/:id/rating', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    const stars = req.body?.stars;
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'invalid_stars' });
    }
    const book = sharedBook(req, res);
    if (!book) return;
    db.prepare(`
      INSERT INTO ratings (book_id, user_id, stars) VALUES (?, ?, ?)
      ON CONFLICT(book_id, user_id) DO UPDATE SET stars = excluded.stars, updated_at = CURRENT_TIMESTAMP
    `).run(book.id, req.user.sub, stars);
    res.json(aggregate(book.id, req.user.sub));
  });

  r.delete('/:id/rating', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    const book = sharedBook(req, res);
    if (!book) return;
    db.prepare('DELETE FROM ratings WHERE book_id = ? AND user_id = ?').run(book.id, req.user.sub);
    res.json(aggregate(book.id, req.user.sub));
  });

  return r;
}
