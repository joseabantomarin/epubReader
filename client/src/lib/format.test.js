import { describe, it, expect } from 'vitest';
import { relativeTime } from './format.js';

describe('relativeTime', () => {
  const now = new Date('2026-05-27T12:00:00Z');
  it('returns "nunca" when value is null/undefined', () => {
    expect(relativeTime(null, now)).toBe('nunca');
    expect(relativeTime(undefined, now)).toBe('nunca');
  });
  it('handles seconds, minutes, hours, days', () => {
    expect(relativeTime('2026-05-27T11:59:30Z', now)).toBe('ahora');
    expect(relativeTime('2026-05-27T11:55:00Z', now)).toBe('hace 5min');
    expect(relativeTime('2026-05-27T10:00:00Z', now)).toBe('hace 2h');
    expect(relativeTime('2026-05-25T12:00:00Z', now)).toBe('hace 2d');
  });
});
