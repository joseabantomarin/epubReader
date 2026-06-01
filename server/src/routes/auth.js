import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { verifyGoogleIdToken, signJwt } from '../auth.js';
import { isAdminEmail } from '../config.js';
import { authRequired } from '../middleware/authRequired.js';

// When a user logs in, attach any pending group invitations addressed to their
// email (rows inserted before they had an account).
export function linkPendingMemberships(db, userId, email) {
  db.prepare(
    'UPDATE group_members SET user_id = ? WHERE user_id IS NULL AND LOWER(email) = LOWER(?)'
  ).run(userId, email);
}

// Permanently delete a user and everything tied to them. The users-row delete
// cascades (foreign_keys = ON) to books, annotations, ratings, owned groups,
// the user's memberships, and reading_progress. The cascade can't reach two
// things, which we handle explicitly inside the same transaction:
//   - pending invitations addressed to the user's email (user_id still NULL),
//   - other users' books that pointed AT this user or their groups, which we
//     reset to private so they don't dangle on a deleted row.
// Files on disk are removed after the transaction commits.
export function deleteUserAccount(db, dataDir, userId, email) {
  const tx = db.transaction(() => {
    const ownedGroupIds = db.prepare('SELECT id FROM groups WHERE owner_id = ?')
      .all(userId).map((row) => row.id);
    if (ownedGroupIds.length) {
      const ph = ownedGroupIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE books SET visibility='private', shared=0, share_group_id=NULL
          WHERE share_group_id IN (${ph})`
      ).run(...ownedGroupIds);
    }
    db.prepare(
      "UPDATE books SET visibility='private', shared=0, share_user_id=NULL WHERE share_user_id = ?"
    ).run(userId);
    db.prepare(
      'DELETE FROM group_members WHERE user_id IS NULL AND LOWER(email) = LOWER(?)'
    ).run(email);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();

  // PII is already gone; a file-removal failure must not fail the request.
  const userDir = path.join(dataDir, 'books', String(userId));
  try {
    fs.rmSync(userDir, { recursive: true, force: true });
  } catch (err) {
    console.error('failed to remove files for deleted user', userId, err);
  }
}

export function createAuthRouter(db, dataDir) {
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

    linkPendingMemberships(db, user.id, user.email);

    const token = signJwt({ sub: user.id, email: user.email });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, name: user.name, picture: user.picture_url,
        isAdmin: isAdminEmail(user.email),
      },
    });
  });

  r.delete('/account', authRequired, (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (!email) return res.status(400).json({ error: 'missing_email' });

    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.user.sub);
    if (!user) return res.status(404).end();
    if (email.toLowerCase() !== user.email.trim().toLowerCase()) {
      return res.status(400).json({ error: 'email_mismatch' });
    }

    deleteUserAccount(db, dataDir, user.id, user.email);
    res.json({ deleted: true });
  });

  return r;
}
