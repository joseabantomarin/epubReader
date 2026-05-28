import AdmZip from 'adm-zip';
import path from 'node:path';

function getText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function findCoverHref(opfXml) {
  const propsMatch = opfXml.match(/<item[^>]+properties=["'][^"']*cover-image[^"']*["'][^>]*>/i);
  if (propsMatch) {
    const href = propsMatch[0].match(/href=["']([^"']+)["']/i);
    if (href) return href[1];
  }
  const metaCover = opfXml.match(/<meta[^>]+name=["']cover["'][^>]+content=["']([^"']+)["']/i);
  if (metaCover) {
    const id = metaCover[1];
    const item = opfXml.match(new RegExp(`<item[^>]+id=["']${id}["'][^>]*>`, 'i'));
    if (item) {
      const href = item[0].match(/href=["']([^"']+)["']/i);
      if (href) return href[1];
    }
  }
  return null;
}

export function parseEpub(filePath) {
  const zip = new AdmZip(filePath);
  const containerEntry = zip.getEntry('META-INF/container.xml');
  if (!containerEntry) throw new Error('not an epub: missing container.xml');
  const containerXml = containerEntry.getData().toString('utf-8');
  const opfHrefMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
  if (!opfHrefMatch) throw new Error('not an epub: missing rootfile path');
  const opfPath = opfHrefMatch[1];

  const opfEntry = zip.getEntry(opfPath);
  if (!opfEntry) throw new Error('not an epub: missing OPF');
  const opfXml = opfEntry.getData().toString('utf-8');

  const title = getText(opfXml, 'dc:title') || getText(opfXml, 'title') || null;
  const author = getText(opfXml, 'dc:creator') || null;

  let cover = null;
  const coverHref = findCoverHref(opfXml);
  if (coverHref) {
    const opfDir = path.posix.dirname(opfPath);
    const coverFullPath = opfDir === '.' ? coverHref : path.posix.join(opfDir, coverHref);
    const coverEntry = zip.getEntry(coverFullPath);
    if (coverEntry) {
      const ext = (path.extname(coverHref).slice(1) || 'jpg').toLowerCase();
      cover = { ext, data: coverEntry.getData() };
    }
  }

  return { title, author, cover };
}
