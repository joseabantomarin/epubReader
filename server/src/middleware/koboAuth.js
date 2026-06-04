import { findUserIdByToken, touchDevice } from '../kobo/devices.js';

/**
 * Build middleware that authenticates a Kobo device by its URL-path token.
 * Sets `req.koboUserId` and `req.koboToken`. The device sends no bearer token;
 * the path token IS the credential.
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').RequestHandler}
 */
export function makeKoboAuth(db) {
  return function koboAuth(req, res, next) {
    const token = req.params.authToken;
    const userId = token ? findUserIdByToken(db, token) : null;
    if (!userId) return res.status(401).json({ error: 'invalid_kobo_token' });
    touchDevice(db, token);
    req.koboUserId = userId;
    req.koboToken = token;
    next();
  };
}
