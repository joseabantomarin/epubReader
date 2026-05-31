import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';

export function createGroupsRouter(db) {
  const r = Router();
  r.use(authRequired);

  // Returns the group row if the user is its owner, else sends 403/404 and null.
  function ownedGroup(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) { res.status(404).end(); return null; }
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    if (!g) { res.status(404).end(); return null; }
    if (g.owner_id !== req.user.sub) { res.status(403).json({ error: 'forbidden' }); return null; }
    return g;
  }

  function memberCount(groupId) {
    return db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(groupId).c;
  }

  // List groups I own or am an active member of.
  r.get('/', (req, res) => {
    const uid = req.user.sub;
    const rows = db.prepare(`
      SELECT g.id, g.name, g.created_at, g.owner_id
        FROM groups g
       WHERE g.owner_id = ?
          OR g.id IN (SELECT group_id FROM group_members WHERE user_id = ?)
       ORDER BY g.created_at DESC
    `).all(uid, uid);
    res.json(rows.map(g => ({
      id: g.id,
      name: g.name,
      createdAt: g.created_at,
      role: g.owner_id === uid ? 'owner' : 'member',
      memberCount: memberCount(g.id),
    })));
  });

  r.post('/', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'missing_name' });
    const id = db.prepare('INSERT INTO groups (owner_id, name) VALUES (?, ?)')
      .run(req.user.sub, name).lastInsertRowid;
    res.json({ id, name, role: 'owner', memberCount: 0, createdAt: null });
  });

  r.patch('/:id', (req, res) => {
    const g = ownedGroup(req, res);
    if (!g) return;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'missing_name' });
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, g.id);
    res.json({ id: g.id, name, role: 'owner', memberCount: memberCount(g.id) });
  });

  r.delete('/:id', (req, res) => {
    const g = ownedGroup(req, res);
    if (!g) return;
    // Books shared to this group revert to private.
    db.prepare("UPDATE books SET visibility='private', share_group_id=NULL, shared=0 WHERE share_group_id = ?")
      .run(g.id);
    db.prepare('DELETE FROM groups WHERE id = ?').run(g.id); // cascades group_members
    res.json({ deleted: 1 });
  });

  return r;
}
