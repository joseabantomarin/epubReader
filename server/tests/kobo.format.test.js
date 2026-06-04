import { describe, it, expect } from 'vitest';
import { toKoboTimestamp, toEpoch, parseDbTime } from '../src/kobo/format.js';

describe('kobo/format', () => {
  it('formats a Date as ISO-8601 with trailing Z', () => {
    expect(toKoboTimestamp(new Date('2026-06-03T12:00:00.000Z'))).toBe('2026-06-03T12:00:00.000Z');
  });

  it('treats a bare SQLite timestamp as UTC, not local', () => {
    expect(toKoboTimestamp('2026-06-03 12:00:00')).toBe('2026-06-03T12:00:00.000Z');
    expect(toEpoch('2026-06-03 12:00:00')).toBe(Math.floor(Date.UTC(2026, 5, 3, 12, 0, 0) / 1000));
  });

  it('toEpoch returns 0 for null/empty', () => {
    expect(toEpoch(null)).toBe(0);
    expect(parseDbTime(null)).toBe(null);
  });
});
