// Nombre del archivo que ve el usuario al descargar un libro.

// Caracteres que ningún sistema de archivos acepta, más los de control.
const INVALID = new RegExp('[/\\\\:*?"<>|\\u0000-\\u001f]', 'g');
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

function clean(value) {
  return String(value || '').replace(INVALID, '').replace(/\s+/g, ' ').trim();
}

export function attachmentName(book, forceExt = null) {
  const title = clean(book.title);
  const author = clean(book.author);
  const ext = forceExt || book.format || 'epub';
  let base = title || `libro-${book.id}`;
  if (title && author) base = `${title} - ${author}`;
  return `${base.slice(0, 100)}.${ext}`;
}

// Cabecera con las dos formas: la ASCII para clientes antiguos y la codificada
// (RFC 5987) para que los acentos lleguen intactos.
export function contentDisposition(name) {
  const ascii = name
    .normalize('NFD').replace(DIACRITICS, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
