import fs from 'node:fs';
import path from 'node:path';

export function bookPath(dataDir, userId, bookId, format = 'epub') {
  return path.join(dataDir, 'books', String(userId), `${bookId}.${format}`);
}

export function coverPath(dataDir, userId, bookId, ext) {
  return path.join(dataDir, 'books', String(userId), `${bookId}.${ext}`);
}

export function ensureUserDir(dataDir, userId) {
  const p = path.join(dataDir, 'books', String(userId));
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function removeBookFiles(dataDir, userId, bookId) {
  const dir = path.join(dataDir, 'books', String(userId));
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(`${bookId}.`)) {
      fs.unlinkSync(path.join(dir, name));
    }
  }
}
