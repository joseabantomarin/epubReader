import { Buffer } from 'node:buffer';

export const SYNC_TOKEN_HEADER = 'x-kobo-synctoken';
const VERSION = '1-1-0';

/** @typedef {{ raw_kobo_store_token: string, books_last_modified: number, books_last_created: number, archive_last_modified: number, reading_state_last_modified: number, tags_last_modified: number }} SyncTokenData */

/** @type {SyncTokenData} */
export const EMPTY_TOKEN = Object.freeze({
  raw_kobo_store_token: '',
  books_last_modified: 0,
  books_last_created: 0,
  archive_last_modified: 0,
  reading_state_last_modified: 0,
  tags_last_modified: 0,
});

/**
 * Decode the `x-kobo-synctoken` request header into token data.
 * @param {string|undefined} headerValue
 * @returns {SyncTokenData}
 */
export function parseSyncToken(headerValue) {
  if (!headerValue) return { ...EMPTY_TOKEN };
  try {
    const pad = '='.repeat((4 - (headerValue.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(headerValue + pad, 'base64').toString('utf-8'));
    return { ...EMPTY_TOKEN, ...(json && json.data ? json.data : {}) };
  } catch {
    return { ...EMPTY_TOKEN };
  }
}

/**
 * Encode token data into a base64 `x-kobo-synctoken` value.
 * @param {Partial<SyncTokenData>} data
 * @returns {string}
 */
export function buildSyncToken(data) {
  const token = { version: VERSION, data: { ...EMPTY_TOKEN, ...data } };
  return Buffer.from(JSON.stringify(token), 'utf-8').toString('base64');
}
