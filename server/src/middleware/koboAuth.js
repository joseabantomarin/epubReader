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
    // userId === null means missing/unknown token; compare to null so a real
    // user_id of 0 would never be treated as unauthenticated.
    if (userId === null) return res.status(401).json({ error: 'invalid_kobo_token' });
    touchDevice(db, token);
    req.koboUserId = userId;
    req.koboToken = token;
    next();
  };
}
