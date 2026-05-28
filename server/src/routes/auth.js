import { Router } from 'express';
import { verifyGoogleIdToken, signJwt } from '../auth.js';

export function createAuthRouter(db) {
  const r = Router();

  r.post('/google', async (req, res) => {
    const { credential } = req.body || {};
    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ error: 'missing_credential' });
    }
    let g;
    try {
      g = await verifyGoogleIdToken(credential);
    } catch {
      return res.status(401).json({ error: 'invalid_google_token' });
    }

    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(g.sub);
    if (!user) {
      const id = db.prepare(
        'INSERT INTO users (google_sub, email, name, picture_url) VALUES (?, ?, ?, ?)'
      ).run(g.sub, g.email, g.name, g.picture).lastInsertRowid;
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    } else {
      db.prepare('UPDATE users SET email = ?, name = ?, picture_url = ? WHERE id = ?')
        .run(g.email, g.name, g.picture, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    const token = signJwt({ sub: user.id, email: user.email });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, picture: user.picture_url },
    });
  });

  return r;
}
