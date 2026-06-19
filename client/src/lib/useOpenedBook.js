import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { useAuth } from '../auth/AuthContext.jsx';
import { importBookFile } from './importBook.js';

// Derive a base file name (no extension) from the opened URI's last segment.
// content:// URIs often carry a document id like "primary:Download/Book.epub";
// we keep the human-ish tail and let the server fill in the real title.
function baseNameFromUrl(url) {
  try {
    const decoded = decodeURIComponent(url.split('?')[0]);
    const seg = decoded.split('/').pop().split(':').pop();
    const cleaned = seg.replace(/\.(epub|pdf)$/i, '').trim();
    return cleaned || null;
  } catch {
    return null;
  }
}

// Sniff magic bytes to decide epub (zip "PK") vs pdf ("%PDF-"). content:// URIs
// have no extension and unreliable MIME types, so the bytes are the source of
// truth; the MIME the blob carries is only a fallback.
async function toBookFile(blob, url) {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK" -> epub container
  let ext = isPdf ? 'pdf' : isZip ? 'epub' : null;
  if (!ext) {
    if (blob.type === 'application/pdf') ext = 'pdf';
    else if (blob.type === 'application/epub+zip') ext = 'epub';
  }
  if (!ext) return null; // not a supported file; ignore the intent
  const base = baseNameFromUrl(url) || 'book';
  const name = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  const type = ext === 'pdf' ? 'application/pdf' : 'application/epub+zip';
  return new File([blob], name, { type });
}

// Handle Android "open with" (ACTION_VIEW): when the app is launched or resumed
// with an .epub/.pdf, read it through Capacitor's content bridge, upload it via
// the same pipeline as the library, and open it in the reader.
export function useOpenedBook() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // The opened File is read into memory immediately (the content:// read grant
  // is short-lived), then held until the user is logged in to upload it.
  const pendingRef = useRef(null);
  const busyRef = useRef(false);

  const flush = useCallback(async () => {
    const file = pendingRef.current;
    if (!file || busyRef.current || !user) return;
    busyRef.current = true;
    try {
      const created = await importBookFile(file);
      pendingRef.current = null;
      navigate(`/read/${created.id}`);
    } catch (e) {
      alert('No se pudo abrir el archivo: ' + (e.body?.error || e.message));
    } finally {
      busyRef.current = false;
    }
  }, [user, navigate]);

  const intake = useCallback(async (url) => {
    if (!url || !/^(content|file):/.test(url)) return; // ignore deep links etc.
    try {
      const resp = await fetch(Capacitor.convertFileSrc(url));
      const blob = await resp.blob();
      const file = await toBookFile(blob, url);
      if (file) {
        pendingRef.current = file;
        flush();
      }
    } catch (e) {
      console.warn('[open] could not read shared file', e);
    }
  }, [flush]);

  // Cold start: the launch intent's URI. Plus live ACTION_VIEW while running.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handler;
    (async () => {
      try {
        const launch = await CapacitorApp.getLaunchUrl();
        if (launch?.url) intake(launch.url);
      } catch {}
      handler = await CapacitorApp.addListener('appUrlOpen', (e) => intake(e.url));
    })();
    return () => { handler?.remove(); };
  }, [intake]);

  // A guest who opens a file gets uploaded once they sign in.
  useEffect(() => { flush(); }, [flush]);
}
