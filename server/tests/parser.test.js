import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEpub } from '../src/epub/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(__dirname, 'fixtures', 'sample.epub');

describe('parseEpub', () => {
  it('extracts title, author, and cover from a valid EPUB', () => {
    const meta = parseEpub(sample);
    expect(meta.title).toBe('Sample Book');
    expect(meta.author).toBe('Jane Doe');
    expect(meta.cover).toBeTruthy();
    expect(meta.cover.ext).toBe('png');
    expect(Buffer.isBuffer(meta.cover.data)).toBe(true);
  });

  it('throws when the file is not a valid zip', () => {
    const bad = path.join(__dirname, 'fixtures', 'bad.txt');
    fs.writeFileSync(bad, 'not a zip');
    expect(() => parseEpub(bad)).toThrow();
    fs.unlinkSync(bad);
  });
});
