// Extract title/author and a page-1 cover from a PDF File, reusing the
// pdfjs build that foliate-js ships in /public/foliate-js/vendor/pdfjs/.
// The URL is built at runtime so Vite doesn't try to bundle the worker.

let pdfjsPromise = null;

async function loadPdfjs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const base = new URL('/foliate-js/vendor/pdfjs/', window.location.origin);
    const mod = await import(/* @vite-ignore */ new URL('pdf.mjs', base).href);
    const lib = mod.pdfjsLib || window.pdfjsLib || mod;
    lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', base).href;
    return lib;
  })();
  return pdfjsPromise;
}

function isPdfMagic(uint8) {
  return uint8[0] === 0x25 && uint8[1] === 0x50
      && uint8[2] === 0x44 && uint8[3] === 0x46
      && uint8[4] === 0x2d;
}

export async function isPdfFile(file) {
  if ((file.name || '').toLowerCase().endsWith('.pdf')) return true;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return isPdfMagic(head);
}

const MAX_COVER_PX = 600; // longest side; keeps cover well under ~150 KB

export async function extractPdfMeta(file) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  let title = null, author = null;
  try {
    const { info } = await doc.getMetadata();
    if (info?.Title && String(info.Title).trim()) title = String(info.Title).trim();
    if (info?.Author && String(info.Author).trim()) author = String(info.Author).trim();
  } catch {}

  let cover = null;
  try {
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const longest = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(MAX_COVER_PX / longest, 2);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    cover = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
  } catch {}

  try { await doc.destroy(); } catch {}
  return { title, author, cover };
}
