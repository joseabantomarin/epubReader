import { describe, it, expect } from 'vitest';
import { makeDb } from './helpers.js';

function cols(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

describe('kobo schema migration', () => {
  it('creates kobo_devices table', () => {
    const db = makeDb();
    const names = cols(db, 'kobo_devices');
    expect(names).toEqual(expect.arrayContaining(['id', 'user_id', 'token', 'name', 'last_seen_at', 'last_db_hash', 'created_at']));
  });

  it('adds kobo columns to books', () => {
    const db = makeDb();
    expect(cols(db, 'books')).toEqual(expect.arrayContaining(['kobo_uuid', 'source']));
  });

  it('adds kobo columns to reading_progress', () => {
    const db = makeDb();
    expect(cols(db, 'reading_progress')).toEqual(
      expect.arrayContaining(['kobo_chapter_id', 'kobo_chapter_progress', 'kobo_location_value', 'source'])
    );
  });
});
