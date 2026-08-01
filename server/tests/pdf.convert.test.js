import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getBookPdf } from '../src/pdf/convert.js';

describe('getBookPdf', () => {
  let tmp, epubPath, pdfPath;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-'));
    epubPath = path.join(tmp, '1.epub');
    pdfPath = path.join(tmp, '1.conv.pdf');
    fs.writeFileSync(epubPath, 'epub');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // Conversor falso: escribe un PDF simulado, sin Chrome de por medio.
  const fakeConvert = () => vi.fn(async (_epub, out) => { fs.writeFileSync(out, '%PDF-fake'); });

  it('convierte cuando el PDF no existe', async () => {
    const convert = fakeConvert();
    const result = await getBookPdf({ epubPath, pdfPath, convert });
    expect(result).toBe(pdfPath);
    expect(convert).toHaveBeenCalledOnce();
    expect(fs.readFileSync(pdfPath, 'utf-8')).toBe('%PDF-fake');
  });

  it('usa la caché si el PDF es más nuevo que el EPUB', async () => {
    fs.writeFileSync(pdfPath, '%PDF-cached');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(pdfPath, future, future);
    const convert = fakeConvert();
    await getBookPdf({ epubPath, pdfPath, convert });
    expect(convert).not.toHaveBeenCalled();
    expect(fs.readFileSync(pdfPath, 'utf-8')).toBe('%PDF-cached');
  });

  it('reconvierte si el EPUB es más nuevo que el PDF', async () => {
    fs.writeFileSync(pdfPath, '%PDF-viejo');
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(pdfPath, past, past);
    const convert = fakeConvert();
    await getBookPdf({ epubPath, pdfPath, convert });
    expect(convert).toHaveBeenCalledOnce();
    expect(fs.readFileSync(pdfPath, 'utf-8')).toBe('%PDF-fake');
  });

  it('dos llamadas concurrentes producen una sola conversión', async () => {
    let calls = 0;
    const convert = vi.fn(async (_epub, out) => {
      calls++;
      await new Promise((r) => setTimeout(r, 40));
      fs.writeFileSync(out, '%PDF-fake');
    });
    const [a, b] = await Promise.all([
      getBookPdf({ epubPath, pdfPath, convert }),
      getBookPdf({ epubPath, pdfPath, convert }),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(pdfPath);
    expect(b).toBe(pdfPath);
  });

  it('propaga el error y no deja el guardián bloqueado', async () => {
    const failing = vi.fn(async () => { throw new Error('boom'); });
    await expect(getBookPdf({ epubPath, pdfPath, convert: failing })).rejects.toThrow('boom');
    // Una segunda llamada vuelve a intentarlo (el guardián se liberó).
    const ok = fakeConvert();
    await getBookPdf({ epubPath, pdfPath, convert: ok });
    expect(ok).toHaveBeenCalledOnce();
  });
});
