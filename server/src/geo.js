import geoip from 'geoip-lite';

// Resolve an IP to a coarse location using the offline geoip-lite database.
// Returns null fields for private/loopback/unknown IPs (geoip.lookup → null).
export function lookupLocation(ip) {
  try {
    const g = ip ? geoip.lookup(ip) : null;
    if (!g) return { country: null, region: null, city: null };
    return {
      country: g.country || null,
      region: g.region || null,
      city: g.city || null,
    };
  } catch {
    return { country: null, region: null, city: null };
  }
}

// Coarse OS name from a User-Agent string. Order matters: Android and iOS UAs
// also contain "Linux"/"Mac OS X", so they must be checked first.
export function parseOS(ua) {
  if (!ua || typeof ua !== 'string') return 'Other';
  if (/windows/i.test(ua)) return 'Windows';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/cros/i.test(ua)) return 'Chrome OS';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

// Obvious crawler User-Agents, skipped so they don't inflate the table.
export function isBot(ua) {
  return !!ua && /bot|crawl|spider|slurp/i.test(ua);
}
