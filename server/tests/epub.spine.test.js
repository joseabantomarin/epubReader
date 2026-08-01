import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { epubToHtml } from '../src/epub/spine.js';

// EPUB mínimo: dos capítulos cuyo orden de spine (b, a) es el inverso del
// alfabético, para comprobar que se respeta el spine y no el orden del zip.
function makeEpub(dir) {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(
    `<?xml version="1.0"?><container><rootfiles>
       <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
     </rootfiles></container>`));
  zip.addFile('OEBPS/content.opf', Buffer.from(
    `<?xml version="1.0"?><package><manifest>
       <item id="a" href="text/a.xhtml" media-type="application/xhtml+xml"/>
       <item id="b" href="text/b.xhtml" media-type="application/xhtml+xml"/>
     </manifest><spine>
       <itemref idref="b"/>
       <itemref idref="a"/>
     </spine></package>`));
  zip.addFile('OEBPS/text/a.xhtml', Buffer.from(
    `<html><head><link rel="stylesheet" href="../css/s.css"/></head>
     <body><p>CAPITULO_A</p><img src="../img/a.png"/></body></html>`));
  zip.addFile('OEBPS/text/b.xhtml', Buffer.from(
    `<html><body><p>CAPITULO_B</p></body></html>`));
  zip.addFile('OEBPS/img/a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  zip.addFile('OEBPS/css/s.css', Buffer.from('p { color: #333 }'));
  const p = path.join(dir, 'book.epub');
  zip.writeZip(p);
  return p;
}

describe('epubToHtml', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('escribe book.html con los capítulos en orden de spine', () => {
    const epub = makeEpub(tmp);
    const out = path.join(tmp, 'out');
    const htmlPath = epubToHtml(epub, out);
    expect(htmlPath).toBe(path.join(out, 'book.html'));
    const html = fs.readFileSync(htmlPath, 'utf-8');
    expect(html.indexOf('CAPITULO_B')).toBeLessThan(html.indexOf('CAPITULO_A'));
  });

  it('reescribe rutas relativas contra la raíz extraída', () => {
    const epub = makeEpub(tmp);
    const out = path.join(tmp, 'out');
    const html = fs.readFileSync(epubToHtml(epub, out), 'utf-8');
    expect(html).toContain('src="OEBPS/img/a.png"');
    expect(html).toContain('href="OEBPS/css/s.css"');
    expect(html).not.toContain('../img/a.png');
    // El recurso existe realmente en el directorio extraído.
    expect(fs.existsSync(path.join(out, 'OEBPS/img/a.png'))).toBe(true);
  });

  it('incluye el CSS de impresión', () => {
    const epub = makeEpub(tmp);
    const html = fs.readFileSync(epubToHtml(epub, path.join(tmp, 'out')), 'utf-8');
    expect(html).toContain('@page');
  });

  it('lanza si el zip no es un EPUB válido', () => {
    const zip = new AdmZip();
    zip.addFile('hola.txt', Buffer.from('no soy un epub'));
    const bad = path.join(tmp, 'bad.epub');
    zip.writeZip(bad);
    expect(() => epubToHtml(bad, path.join(tmp, 'out2'))).toThrow();
  });
});
