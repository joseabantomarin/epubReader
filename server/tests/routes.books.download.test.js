import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createBooksRouter } from '../src/routes/books.js';
import { attachmentName } from '../src/downloadName.js';
import { getBookPdf } from '../src/pdf/convert.js';

process.env.NODE_ENV = 'test';

// La conversión real necesita Chrome; aquí solo se comprueba el cableado.
vi.mock('../src/pdf/convert.js', () => ({
  getBookPdf: vi.fn(async ({ pdfPath }) => {
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.writeFileSync(pdfPath, '%PDF-convertido');
    return pdfPath;
  }),
}));

describe('attachmentName', () => {
  it('compone «título - autor.ext»', () => {
    expect(attachmentName({ id: 1, title: 'Oráculo manual', author: 'Baltasar Gracián', format: 'epub' }))
      .toBe('Oráculo manual - Baltasar Gracián.epub');
  });

  it('sin autor usa solo el título', () => {
    expect(attachmentName({ id: 1, title: 'Solo', format: 'pdf' })).toBe('Solo.pdf');
  });

  it('sin título cae en libro-<id>', () => {
    expect(attachmentName({ id: 7, title: null, format: 'epub' })).toBe('libro-7.epub');
  });

  it('quita caracteres inválidos para un nombre de archivo', () => {
    const name = attachmentName({ id: 1, title: 'a/b\\c:d*e?f"g<h>i|j', format: 'epub' });
    expect(name).toBe('abcdefghij.epub');
  });

  it('permite forzar la extensión', () => {
    expect(attachmentName({ id: 1, title: 'Libro', format: 'epub' }, 'pdf')).toBe('Libro.pdf');
  });
});

describe('descarga de libros', () => {
  let db, alice, bob, a, dataDir;

  function app(database, dir) {
    const x = express();
    x.use(express.json());
    x.use('/api/books', createBooksRouter(database, dir));
    return x;
  }

  // Inserta el libro y escribe su archivo real en disco.
  function insertBook(userId, { title = 'Libro', author = 'Autor', format = 'epub' } = {}) {
    const id = db.prepare(
      'INSERT INTO books (user_id, title, author, file_path, format) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, title, author, 'p', format).lastInsertRowid;
    const dir = path.join(dataDir, 'books', String(userId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.${format}`), `contenido-${format}`);
    return id;
  }

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
    db = makeDb();
    alice = insertUser(db, { email: 'alice@x.com' });
    bob = insertUser(db, { email: 'bob@x.com' });
    a = app(db, dataDir);
    getBookPdf.mockClear();
  });
  afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

  it('descarga el original como adjunto con nombre legible', async () => {
    const id = insertBook(alice.id, { title: 'Oráculo', author: 'Gracián' });
    const res = await request(a).get(`/api/books/${id}/download`).set(authHeader(alice));
    expect(res.status).toBe(200);
    const cd = res.headers['content-disposition'];
    expect(cd).toContain('attachment');
    expect(cd).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(cd.split("filename*=UTF-8''")[1])).toBe('Oráculo - Gracián.epub');
  });

  it('404 con un libro de otro usuario', async () => {
    const id = insertBook(bob.id);
    const res = await request(a).get(`/api/books/${id}/download`).set(authHeader(alice));
    expect(res.status).toBe(404);
  });

  it('401 sin sesión', async () => {
    const id = insertBook(alice.id);
    const res = await request(a).get(`/api/books/${id}/download`);
    expect(res.status).toBe(401);
  });

  it('acepta el token por query (?_t=) para navegación directa', async () => {
    const id = insertBook(alice.id);
    const token = authHeader(alice).Authorization.replace('Bearer ', '');
    const res = await request(a).get(`/api/books/${id}/download?_t=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
  });

  it('un libro que ya es PDF se sirve sin convertir', async () => {
    const id = insertBook(alice.id, { format: 'pdf' });
    const res = await request(a).get(`/api/books/${id}/download.pdf`).set(authHeader(alice));
    expect(res.status).toBe(200);
    expect(getBookPdf).not.toHaveBeenCalled();
  });

  it('un EPUB se convierte y se entrega como PDF', async () => {
    const id = insertBook(alice.id, { title: 'Novela', format: 'epub' });
    const res = await request(a).get(`/api/books/${id}/download.pdf`).set(authHeader(alice));
    expect(res.status).toBe(200);
    expect(getBookPdf).toHaveBeenCalledOnce();
    const cd = res.headers['content-disposition'];
    expect(decodeURIComponent(cd.split("filename*=UTF-8''")[1])).toBe('Novela - Autor.pdf');
  });
});
