import { useCallback, useEffect, useRef, useState } from 'react';

// Drives window.speechSynthesis to read from the current page for `minutes`,
// advancing the foliate view one page after each utterance ends.
export function useReadAloud({ getView, getPageText, lang }) {
  const [reading, setReading] = useState(false);
  const stopRef = useRef(false);

  const stop = useCallback(() => {
    stopRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {}
    setReading(false);
  }, []);

  const speak = useCallback((text) => new Promise((resolve) => {
    if (!text || !text.trim()) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    const voice = window.speechSynthesis.getVoices()
      .find(v => lang && v.lang?.toLowerCase().startsWith(String(lang).toLowerCase().split('-')[0]));
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  }), [lang]);

  const start = useCallback(async (minutes) => {
    const view = getView();
    if (!view) return;
    stopRef.current = false;
    setReading(true);
    const deadline = performance.now() + minutes * 60_000;
    try {
      while (!stopRef.current && performance.now() < deadline) {
        const text = getPageText();
        await speak(text);
        if (stopRef.current || performance.now() >= deadline) break;
        const before = view.renderer?.start;
        await view.next();
        await new Promise(r => setTimeout(r, 250)); // let relocate settle
        if (view.renderer?.start === before) break; // end of book / couldn't advance
      }
    } finally {
      try { window.speechSynthesis.cancel(); } catch {}
      setReading(false);
    }
  }, [getView, getPageText, speak]);

  useEffect(() => () => { stopRef.current = true; try { window.speechSynthesis.cancel(); } catch {} }, []);

  return { reading, start, stop };
}
