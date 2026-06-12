import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { kepubPath } from '../src/storage.js';

describe('kepubPath', () => {
  it('builds <dataDir>/books/<userId>/<bookId>.kepub.epub', () => {
    expect(kepubPath('/data', 7, 42)).toBe(path.join('/data', 'books', '7', '42.kepub.epub'));
  });
});
