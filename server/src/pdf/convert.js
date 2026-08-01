import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { epubToHtml } from '../epub/spine.js';

const execFileAsync = promisify(execFile);

const CHROME_BIN = process.env.CHROME_BIN || '/usr/bin/google-chrome';
const TIMEOUT_MS = 90_000;

// Conversiones en curso por ruta de destino: dos peticiones del mismo libro
// comparten el trabajo en vez de lanzar dos Chrome a la vez.
const inFlight = new Map();

// Renderiza un HTML local a PDF con Chrome headless. --no-sandbox es necesario
// en el servidor (proceso sin privilegios y sin namespaces de usuario).
export async function htmlToPdf(htmlPath, pdfPath, { chromeBin = CHROME_BIN, timeoutMs = TIMEOUT_MS } = {}) {
  await execFileAsync(chromeBin, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ], { timeout: timeoutMs });
  if (!fs.existsSync(pdfPath)) throw new Error('pdf_failed: chrome produced no output');
}

// Conversión completa EPUB → PDF en un directorio temporal que siempre se
// limpia. Es el `convert` por defecto de getBookPdf.
export async function convertEpubToPdf(epubPath, pdfPath, opts = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'epub2pdf-'));
  try {
    const htmlPath = epubToHtml(epubPath, work);
    const tmpPdf = path.join(work, 'out.pdf');
    await htmlToPdf(htmlPath, tmpPdf, opts);
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.copyFileSync(tmpPdf, pdfPath);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// Devuelve la ruta del PDF del libro, generándolo solo si hace falta: se
// reutiliza el de la caché mientras sea al menos tan nuevo como el EPUB.
export async function getBookPdf({ epubPath, pdfPath, convert = convertEpubToPdf }) {
  if (fs.existsSync(pdfPath)) {
    const pdfTime = fs.statSync(pdfPath).mtimeMs;
    const epubTime = fs.statSync(epubPath).mtimeMs;
    if (pdfTime >= epubTime) return pdfPath;
  }
  const running = inFlight.get(pdfPath);
  if (running) return running;

  const job = (async () => { await convert(epubPath, pdfPath); return pdfPath; })()
    .finally(() => inFlight.delete(pdfPath));
  inFlight.set(pdfPath, job);
  return job;
}
