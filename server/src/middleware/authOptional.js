import { verifyJwt } from '../auth.js';

export function authOptional(req, _res, next) {
  let token = null;
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (match) {
    token = match[1];
  } else if (req.body && typeof req.body._t === 'string') {
    token = req.body._t;
    delete req.body._t;
  } else if (req.query && typeof req.query._t === 'string') {
    token = req.query._t;
  }
  req.user = null;
  if (token) {
    try {
      const payload = verifyJwt(token);
      req.user = { sub: payload.sub, email: payload.email };
    } catch { /* anonymous */ }
  }
  next();
}
