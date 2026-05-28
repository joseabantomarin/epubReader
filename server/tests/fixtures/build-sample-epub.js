// Run with: node server/tests/fixtures/build-sample-epub.js
// Produces server/tests/fixtures/sample.epub
import AdmZip from 'adm-zip';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, 'sample.epub');

const zip = new AdmZip();

// mimetype must be the first entry and STORED (epub spec).
zip.addFile('mimetype', Buffer.from('application/epub+zip'), '', 0);

zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`));

zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bid">test-id</dc:identifier>
    <dc:title>Sample Book</dc:title>
    <dc:creator>Jane Doe</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`));

// 1x1 PNG cover
const png = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108020000009077' +
  '53DE0000000C49444154789C6360000000000200013E29C9D40000000049454E44AE426082',
  'hex'
);
zip.addFile('OEBPS/cover.png', png);

zip.addFile('OEBPS/ch1.xhtml', Buffer.from(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ch1</title></head><body><p>Hello.</p></body></html>`));

zip.writeZip(out);
console.log('wrote', out);
