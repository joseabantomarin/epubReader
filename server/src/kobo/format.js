/**
 * Parse a value into a Date. SQLite `CURRENT_TIMESTAMP` produces
 * 'YYYY-MM-DD HH:MM:SS' in UTC but without a zone; JS Date would read that as
 * local time, so we normalise it to explicit UTC.
 * @param {string|Date|null|undefined} value
 * @returns {Date|null}
 */
export function parseDbTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a value as a Kobo timestamp (ISO-8601 UTC with milliseconds + 'Z').
 * Falls back to "now" when the value is empty.
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
export function toKoboTimestamp(value) {
  const d = parseDbTime(value) || new Date();
  return d.toISOString();
}

/**
 * Unix epoch seconds for a value, or 0 when empty/unparseable.
 * @param {string|Date|null|undefined} value
 * @returns {number}
 */
export function toEpoch(value) {
  const d = parseDbTime(value);
  return d ? Math.floor(d.getTime() / 1000) : 0;
}
