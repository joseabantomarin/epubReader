import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bookPath, coverPath, ensureUserDir, removeBookFiles } from '../src/storage.js';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'er-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('storage helpers', () => {
  it('builds deterministic paths for book and cover', () => {
    expect(bookPath(tmp, 5, 42)).toBe(path.join(tmp, 'books', '5', '42.epub'));
    expect(coverPath(tmp, 5, 42, 'jpg')).toBe(path.join(tmp, 'books', '5', '42.jpg'));
  });

  it('ensureUserDir creates the directory', () => {
    const p = ensureUserDir(tmp, 9);
    expect(fs.existsSync(p)).toBe(true);
    expect(p).toBe(path.join(tmp, 'books', '9'));
  });

  it('removeBookFiles deletes epub and any matching cover', () => {
    const dir = ensureUserDir(tmp, 1);
    fs.writeFileSync(path.join(dir, '7.epub'), 'x');
    fs.writeFileSync(path.join(dir, '7.jpg'), 'x');
    removeBookFiles(tmp, 1, 7);
    expect(fs.existsSync(path.join(dir, '7.epub'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '7.jpg'))).toBe(false);
  });
});
