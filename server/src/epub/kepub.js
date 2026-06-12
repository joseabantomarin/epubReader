import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { bookPath, kepubPath } from '../storage.js';

/**
 * Convert an EPUB to a KEPUB at `outPath` using the kepubify binary.
 * kepubify writes into an output directory, so we run it against a temp dir
 * and copy the produced `*.kepub.epub` to the canonical `outPath`. This is
 * robust to kepubify's output-naming.
 * @param {string} epubPath
 * @param {string} outPath
 * @param {{ bin?: string }} [opts]
 * @returns {Promise<string>} resolves to outPath
 */
export async function toKepub(epubPath, outPath, opts = {}) {
  const bin = opts.bin || config.kepubifyBin;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kepubify-'));
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      const child = spawn(bin, ['--output', tmpDir, epubPath], { stdio: 'ignore' });
      child.on('error', (err) => settle(reject, err));
      child.on('exit', (code) => (code === 0 ? settle(resolve) : settle(reject, new Error(`kepubify exited ${code}`))));
    });
    const produced = fs.readdirSync(tmpDir).find((f) => f.endsWith('.kepub.epub'));
    if (!produced) throw new Error('kepubify produced no .kepub.epub output');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    // Promote atomically: copy into a unique temp file on the SAME filesystem as
    // outPath, then rename. A crash mid-copy leaves only the temp file, never a
    // truncated outPath, and concurrent conversions each use their own temp file.
    const stagePath = `${outPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.copyFileSync(path.join(tmpDir, produced), stagePath);
      fs.renameSync(stagePath, outPath);
    } catch (err) {
      fs.rmSync(stagePath, { force: true });
      throw err;
    }
    return outPath;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Return the cached KEPUB path for a book, generating it on first use.
 * @param {string} dataDir
 * @param {number} userId
 * @param {{ id: number, format?: string }} book
 * @param {{ bin?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function ensureKepub(dataDir, userId, book, opts = {}) {
  const out = kepubPath(dataDir, userId, book.id);
  if (fs.existsSync(out)) return out;
  const epub = bookPath(dataDir, userId, book.id, book.format || 'epub');
  await toKepub(epub, out, opts);
  return out;
}
