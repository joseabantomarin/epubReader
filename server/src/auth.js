import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';

const JWT_EXPIRES_IN = '30d';

export function signJwt(payload) {
  return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });
}

export function verifyJwt(token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

const googleClient = new OAuth2Client(config.googleClientId);

export async function verifyGoogleIdToken(credential) {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error('Invalid Google token payload');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || null,
    picture: payload.picture || null,
  };
}
