import { api } from './api.js';
import { isPdfFile, extractPdfMeta } from './pdfMeta.js';

// Upload a book File to the server, extracting PDF metadata client-side first
// (the server parses EPUB metadata itself). Shared by the library "Agregar"
// button and the Android "open with" intake so both behave identically.
export async function importBookFile(file) {
  let extras = {};
  if (await isPdfFile(file)) {
    try {
      const meta = await extractPdfMeta(file);
      extras = { title: meta.title, author: meta.author, cover: meta.cover };
    } catch (err) {
      console.warn('[pdf] metadata extraction failed', err);
    }
  }
  return api.uploadBook(file, extras);
}
