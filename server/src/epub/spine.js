import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';

// Convierte un EPUB en un único HTML imprimible: extrae el zip, recorre el
// spine en orden de lectura y concatena el cuerpo de cada documento con las
// rutas de sus recursos resueltas contra la raíz extraída. El resultado lo
// renderiza Chrome headless (ver ../pdf/convert.js).

const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

// Resuelve una URL relativa de un documento contra la raíz del EPUB extraído.
// Las absolutas (http:, data:, anclas) se dejan intactas.
function resolveHref(url, docPath) {
  if (!url || ABSOLUTE_URL.test(url)) return null;
  const [rawPath, hash] = url.split('#');
  if (!rawPath) return null;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(docPath), rawPath),
  );
  return hash ? `${resolved}#${hash}` : resolved;
}

function rewriteUrls(html, docPath) {
  return html.replace(/\b(src|href)=(["'])(.*?)\2/gi, (match, attr, quote, url) => {
    const resolved = resolveHref(url, docPath);
    return resolved ? `${attr}=${quote}${resolved}${quote}` : match;
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

function readOpf(outDir) {
  const containerPath = path.join(outDir, 'META-INF', 'container.xml');
  if (!fs.existsSync(containerPath)) throw new Error('epub_invalid: missing container.xml');
  const container = fs.readFileSync(containerPath, 'utf-8');
  const rootfile = container.match(/full-path=["']([^"']+)["']/i);
  if (!rootfile) throw new Error('epub_invalid: missing rootfile path');
  const opfPath = decodeURIComponent(rootfile[1]);
  const opfFile = path.join(outDir, opfPath);
  if (!fs.existsSync(opfFile)) throw new Error('epub_invalid: missing OPF');
  return { opfPath, opfXml: fs.readFileSync(opfFile, 'utf-8') };
}

// Documentos del spine, en orden de lectura, como rutas relativas a outDir.
function spineDocs(opfXml, opfPath) {
  const opfDir = path.posix.dirname(opfPath.split(path.sep).join('/'));
  const manifest = new Map();
  for (const tag of opfXml.match(/<item\s[^>]*>/gi) || []) {
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    if (!id || !href) continue;
    const rel = decodeURIComponent(href);
    manifest.set(id, opfDir === '.' ? rel : path.posix.join(opfDir, rel));
  }
  const docs = [];
  for (const tag of opfXml.match(/<itemref\s[^>]*>/gi) || []) {
    const idref = attr(tag, 'idref');
    const href = idref && manifest.get(idref);
    if (href) docs.push(href);
  }
  if (docs.length === 0) throw new Error('epub_invalid: empty spine');
  return docs;
}

const PRINT_CSS = `
  @page { margin: 18mm 15mm; }
  html, body { margin: 0; padding: 0; }
  img, svg { max-width: 100%; height: auto; }
  section.chapter { break-before: page; page-break-before: always; }
  section.chapter:first-of-type { break-before: auto; page-break-before: avoid; }
`;

export function epubToHtml(epubPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  new AdmZip(epubPath).extractAllTo(outDir, true);

  const { opfPath, opfXml } = readOpf(outDir);
  const docs = spineDocs(opfXml, opfPath);

  const sheets = new Set();
  const sections = [];
  for (const docPath of docs) {
    const file = path.join(outDir, docPath);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf-8');

    for (const tag of raw.match(/<link\s[^>]*>/gi) || []) {
      if (!/stylesheet/i.test(tag)) continue;
      const resolved = resolveHref(attr(tag, 'href'), docPath);
      if (resolved) sheets.add(resolved);
    }
    // Los <style> del head se pierden al quedarnos con el body: se rescatan.
    const inline = (raw.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');

    const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const content = body ? body[1] : raw;
    sections.push(`<section class="chapter">${inline}${rewriteUrls(content, docPath)}</section>`);
  }
  if (sections.length === 0) throw new Error('epub_invalid: no readable documents');

  const links = [...sheets].map((h) => `<link rel="stylesheet" href="${h}"/>`).join('\n');
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
${links}
<style>${PRINT_CSS}</style>
</head>
<body>
${sections.join('\n')}
</body>
</html>`;

  const htmlPath = path.join(outDir, 'book.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  return htmlPath;
}
