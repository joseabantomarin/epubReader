import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toKepub, ensureKepub } from '../src/epub/kepub.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_BIN = path.join(__dirname, 'fixtures', 'fake-kepubify.mjs');

beforeAll(() => fs.chmodSync(FAKE_BIN, 0o755));

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kepub-test-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('toKepub', () => {
  it('converts an epub to the given output path', async () => {
    const epub = path.join(tmp, 'book.epub');
    fs.writeFileSync(epub, 'ORIGINAL-EPUB-BYTES');
    const out = path.join(tmp, 'out.kepub.epub');
    const result = await toKepub(epub, out, { bin: FAKE_BIN });
    expect(result).toBe(out);
    const written = fs.readFileSync(out, 'utf-8');
    expect(written.startsWith('KEPUB\n')).toBe(true);
    expect(written).toContain('ORIGINAL-EPUB-BYTES');
  });

  it('rejects when the binary cannot be run', async () => {
    const epub = path.join(tmp, 'book.epub');
    fs.writeFileSync(epub, 'x');
    await expect(
      toKepub(epub, path.join(tmp, 'out.kepub.epub'), { bin: '/nonexistent/kepubify' })
    ).rejects.toThrow();
  });
});

describe('ensureKepub', () => {
  it('generates on first call and caches on subsequent calls', async () => {
    fs.mkdirSync(path.join(tmp, 'books', '5'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'books', '5', '9.epub'), 'EPUBDATA');
    const book = { id: 9, format: 'epub' };

    const first = await ensureKepub(tmp, 5, book, { bin: FAKE_BIN });
    expect(first).toBe(path.join(tmp, 'books', '5', '9.kepub.epub'));
    expect(fs.existsSync(first)).toBe(true);

    const second = await ensureKepub(tmp, 5, book, { bin: '/nonexistent/kepubify' });
    expect(second).toBe(first);
  });
});
