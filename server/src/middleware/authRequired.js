import { verifyJwt } from '../auth.js';

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    const payload = verifyJwt(match[1]);
    req.user = { sub: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}
