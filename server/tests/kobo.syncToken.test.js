import { describe, it, expect } from 'vitest';
import { parseSyncToken, buildSyncToken, SYNC_TOKEN_HEADER, EMPTY_TOKEN } from '../src/kobo/syncToken.js';

describe('kobo/syncToken', () => {
  it('header name is correct', () => {
    expect(SYNC_TOKEN_HEADER).toBe('x-kobo-synctoken');
  });

  it('parses an empty/missing header to zeroed data', () => {
    expect(parseSyncToken(undefined)).toEqual(EMPTY_TOKEN);
    expect(parseSyncToken('')).toEqual(EMPTY_TOKEN);
  });

  it('round-trips data through build -> parse', () => {
    const built = buildSyncToken({ books_last_created: 1700000000, reading_state_last_modified: 1700000500 });
    const parsed = parseSyncToken(built);
    expect(parsed.books_last_created).toBe(1700000000);
    expect(parsed.reading_state_last_modified).toBe(1700000500);
    expect(parsed.tags_last_modified).toBe(0);
  });

  it('tolerates malformed base64 by returning the empty token', () => {
    expect(parseSyncToken('!!!not-base64!!!')).toEqual(EMPTY_TOKEN);
  });
});
