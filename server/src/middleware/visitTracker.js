import { lookupLocation, parseOS, isBot } from '../geo.js';

const SKIP_PREFIXES = ['/api', '/downloads', '/kobo'];

// A "page load" is a GET for an HTML document: the root, a SPA route, or a
// .html page — never an asset (has a non-.html extension) or an API/download/
// kobo path. Internal SPA navigation does not hit the server, so it is not
// counted; only real document loads/reloads and deep links are.
export function isPageLoad(req) {
  if (req.method !== 'GET') return false;
  const p = req.path || '';
  if (SKIP_PREFIXES.some((pre) => p === pre || p.startsWith(pre + '/'))) return false;
  const last = p.split('/').pop() || '';
  const dot = last.lastIndexOf('.');
  const ext = dot >= 0 ? last.slice(dot).toLowerCase() : '';
  if (ext && ext !== '.html') return false;
  return true;
}

// Express middleware: logs one row per page load. Wrapped in try/catch so
// tracking can never break serving the page.
export function createVisitTracker(db) {
  const insert = db.prepare(
    `INSERT INTO visits (ip, country, region, city, os, path, user_agent)
     VALUES (@ip, @country, @region, @city, @os, @path, @user_agent)`
  );
  return function visitTracker(req, _res, next) {
    try {
      const ua = req.headers['user-agent'] || null;
      if (isPageLoad(req) && !isBot(ua)) {
        const loc = lookupLocation(req.ip);
        insert.run({
          ip: req.ip || null,
          country: loc.country,
          region: loc.region,
          city: loc.city,
          os: parseOS(ua),
          path: req.path || null,
          user_agent: ua,
        });
      }
    } catch {
      // tracking must never break the request
    }
    next();
  };
}
