import { useCallback, useEffect, useRef, useState } from 'react';

// Drives window.speechSynthesis to read from the current page for `minutes`,
// advancing the foliate view one page after each utterance ends.
export function useReadAloud({ getView, getPageText, lang }) {
  const [reading, setReading] = useState(false);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  const stop = useCallback(() => {
    stopRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {}
    setReading(false);
  }, []);

  // getVoices() is async in Chromium (empty until 'voiceschanged') — and that's
  // the Android WebView engine — so resolve the list once before speaking.
  const ensureVoices = () => new Promise((resolve) => {
    const ss = window.speechSynthesis;
    const have = ss.getVoices();
    if (have.length) { resolve(have); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ss.removeEventListener?.('voiceschanged', finish);
      resolve(ss.getVoices());
    };
    ss.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, 1000); // fallback if the event never fires
  });

  const speak = useCallback(async (text) => {
    if (!text || !text.trim()) return;
    const voices = await ensureVoices();
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (lang) u.lang = lang;
      const prefix = lang ? String(lang).toLowerCase().split('-')[0] : '';
      const voice = prefix ? voices.find(v => v.lang?.toLowerCase().startsWith(prefix)) : null;
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }, [lang]);

  const start = useCallback(async (minutes) => {
    if (runningRef.current) return; // already reading
    const view = getView();
    if (!view) return;
    runningRef.current = true;
    stopRef.current = false;
    setReading(true);
    const deadline = performance.now() + minutes * 60_000;
    let lastText = null;
    try {
      while (!stopRef.current && performance.now() < deadline) {
        const text = getPageText();
        // Within a multi-page section getPageText() returns the same section
        // text, so only read NEW content; otherwise advance pages silently
        // until the next section loads (avoids re-reading the same section).
        const isNew = text && text !== lastText;
        if (isNew) {
          await speak(text);
          lastText = text;
          if (stopRef.current || performance.now() >= deadline) break;
        }
        const before = view.renderer?.start;
        await view.next();
        await new Promise(r => setTimeout(r, isNew ? 200 : 60)); // let relocate settle
        if (view.renderer?.start === before) break; // end of book / no advance
      }
    } finally {
      runningRef.current = false;
      try { window.speechSynthesis.cancel(); } catch {}
      if (mountedRef.current) setReading(false);
    }
  }, [getView, getPageText, speak]);

  useEffect(() => () => {
    mountedRef.current = false;
    stopRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {}
  }, []);

  return { reading, start, stop };
}
