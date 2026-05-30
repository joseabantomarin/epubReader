import { useCallback, useEffect, useRef, useState } from 'react';

// foliate's TTS emits SSML (with <mark>/<break> elements). For the Web Speech
// API we only need the plain text — strip the SSML to its text content.
function ssmlToText(ssml) {
  if (!ssml || typeof ssml !== 'string') return '';
  try {
    const doc = new DOMParser().parseFromString(ssml, 'application/xml');
    return (doc.documentElement?.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// Reads aloud from the CURRENT page using foliate-js's built-in TTS, which
// walks the document block-by-block and scrolls to each block as it is spoken
// (so the visible page follows the audio). Each block is spoken with the Web
// Speech API; it crosses into the next section automatically, and stops on the
// time budget, end of book, Stop, or unmount.
export function useReadAloud({ getView, lang }) {
  const [reading, setReading] = useState(false);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  const stop = useCallback(() => {
    stopRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {}
    setReading(false);
  }, []);

  // getVoices() is async in Chromium (the Android WebView engine): empty until
  // 'voiceschanged'. Resolve the list once before speaking.
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

  const speak = useCallback((text, voices) => new Promise((resolve) => {
    const ss = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    const prefix = lang ? String(lang).toLowerCase().split('-')[0] : '';
    const voice = prefix ? voices.find(v => v.lang?.toLowerCase().startsWith(prefix)) : null;
    if (voice) u.voice = voice;
    // Chromium (incl. the Android WebView) stops utterances longer than ~15s;
    // a periodic pause+resume keeps long blocks playing to the end.
    let keepAlive = null;
    const done = () => { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } resolve(); };
    u.onend = done;
    u.onerror = done;
    ss.speak(u);
    keepAlive = setInterval(() => {
      if (!ss.speaking) { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } return; }
      ss.pause(); ss.resume();
    }, 10000);
  }), [lang]);

  const start = useCallback(async (minutes) => {
    if (runningRef.current) return;
    const view = getView();
    if (!view || typeof view.initTTS !== 'function') return;
    runningRef.current = true;
    stopRef.current = false;
    setReading(true);
    const deadline = performance.now() + minutes * 60_000;
    const voices = await ensureVoices();
    try {
      await view.initTTS('sentence');
      // Start at the block under the current page; fall back to the section start.
      let ssml = view.lastLocation?.range
        ? view.tts.from(view.lastLocation.range)
        : view.tts.start();

      while (!stopRef.current && performance.now() < deadline) {
        const text = ssmlToText(ssml);
        if (text) {
          await speak(text, voices);
          if (stopRef.current || performance.now() >= deadline) break;
        }
        // Advance to the next block; paused=true makes foliate scroll the page
        // to that block so the view follows the audio.
        let nextSsml = view.tts.next(true);
        if (nextSsml == null) {
          // End of this section — load the next one and continue from its start.
          const before = view.renderer?.start;
          await view.next();
          await new Promise(r => setTimeout(r, 300)); // let the section load
          if (view.renderer?.start === before) break;  // end of book / no advance
          await view.initTTS('sentence');
          nextSsml = view.tts.start();
          if (nextSsml == null) break;
        }
        ssml = nextSsml;
      }
    } catch { /* best-effort: stop quietly on any TTS/render error */ }
    finally {
      runningRef.current = false;
      try { window.speechSynthesis.cancel(); } catch {}
      if (mountedRef.current) setReading(false);
    }
  }, [getView, speak]);

  useEffect(() => () => {
    mountedRef.current = false;
    stopRef.current = true;
    try { window.speechSynthesis.cancel(); } catch {}
  }, []);

  return { reading, start, stop };
}
