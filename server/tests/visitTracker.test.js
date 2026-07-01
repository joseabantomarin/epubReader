import { describe, it, expect } from 'vitest';
import { isPageLoad, createVisitTracker } from '../src/middleware/visitTracker.js';
import { makeDb } from './helpers.js';

function fakeReq({ method = 'GET', path = '/', ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', ip = '1.2.3.4' } = {}) {
  return { method, path, ip, headers: { 'user-agent': ua } };
}
function run(mw, req) {
  let called = false;
  mw(req, {}, () => { called = true; });
  return called;
}

describe('isPageLoad', () => {
  it('counts the root, SPA routes and .html pages', () => {
    expect(isPageLoad(fakeReq({ path: '/' }))).toBe(true);
    expect(isPageLoad(fakeReq({ path: '/grupos' }))).toBe(true);
    expect(isPageLoad(fakeReq({ path: '/read/123' }))).toBe(true);
    expect(isPageLoad(fakeReq({ path: '/privacy.html' }))).toBe(true);
  });
  it('ignores assets, api, downloads, kobo and non-GET', () => {
    expect(isPageLoad(fakeReq({ path: '/assets/index-x.js' }))).toBe(false);
    expect(isPageLoad(fakeReq({ path: '/favicon.ico' }))).toBe(false);
    expect(isPageLoad(fakeReq({ path: '/api/books' }))).toBe(false);
    expect(isPageLoad(fakeReq({ path: '/downloads/mislibros.apk' }))).toBe(false);
    expect(isPageLoad(fakeReq({ path: '/kobo/abc' }))).toBe(false);
    expect(isPageLoad(fakeReq({ method: 'POST', path: '/' }))).toBe(false);
  });
});

describe('createVisitTracker', () => {
  it('inserts one row on a page load and calls next', () => {
    const db = makeDb();
    const mw = createVisitTracker(db);
    expect(run(mw, fakeReq({ path: '/', ip: '8.8.8.8' }))).toBe(true);
    const rows = db.prepare('SELECT * FROM visits').all();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ os: 'Windows', path: '/', ip: '8.8.8.8' });
  });
  it('does not insert for assets or api', () => {
    const db = makeDb();
    const mw = createVisitTracker(db);
    run(mw, fakeReq({ path: '/assets/x.js' }));
    run(mw, fakeReq({ path: '/api/health' }));
    expect(db.prepare('SELECT COUNT(*) c FROM visits').get().c).toBe(0);
  });
  it('skips bots', () => {
    const db = makeDb();
    const mw = createVisitTracker(db);
    run(mw, fakeReq({ path: '/', ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' }));
    expect(db.prepare('SELECT COUNT(*) c FROM visits').get().c).toBe(0);
  });
  it('never throws and still calls next if the insert fails', () => {
    const brokenDb = { prepare: () => ({ run: () => { throw new Error('boom'); } }) };
    const mw = createVisitTracker(brokenDb);
    expect(run(mw, fakeReq({ path: '/' }))).toBe(true);
  });
});
