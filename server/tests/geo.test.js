import { describe, it, expect } from 'vitest';
import { parseOS, isBot, lookupLocation } from '../src/geo.js';

describe('parseOS', () => {
  it('detects Windows', () => {
    expect(parseOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });
  it('detects Android before Linux', () => {
    expect(parseOS('Mozilla/5.0 (Linux; Android 13; Pixel 7)')).toBe('Android');
  });
  it('detects iOS', () => {
    expect(parseOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iOS');
  });
  it('detects macOS', () => {
    expect(parseOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS');
  });
  it('detects Linux', () => {
    expect(parseOS('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
  });
  it('returns Other for unknown or empty', () => {
    expect(parseOS('curl/8.0')).toBe('Other');
    expect(parseOS(undefined)).toBe('Other');
  });
});

describe('isBot', () => {
  it('flags crawlers', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
  });
  it('does not flag a normal browser or empty UA', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe(false);
    expect(isBot(undefined)).toBe(false);
  });
});

describe('lookupLocation', () => {
  it('returns null fields for a loopback IP', () => {
    expect(lookupLocation('127.0.0.1')).toEqual({ country: null, region: null, city: null });
  });
  it('never throws on bad input', () => {
    expect(lookupLocation(null)).toEqual({ country: null, region: null, city: null });
  });
});
