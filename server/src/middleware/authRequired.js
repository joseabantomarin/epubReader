import { verifyJwt } from '../auth.js';

export function authRequired(req, res, next) {
  let token = null;
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (match) {
    token = match[1];
  } else if (req.body && typeof req.body._t === 'string') {
    token = req.body._t;
    delete req.body._t;
  }
  if (!token) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    const payload = verifyJwt(token);
    req.user = { sub: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}
