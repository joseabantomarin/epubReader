import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

const IS_NATIVE = Capacitor.isNativePlatform();

// foliate's TTS emits SSML (with <mark>/<break> elements). For speech we only
// need the plain text — strip the SSML to its text content.
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
// (so the visible page follows the audio). It crosses into the next section
// automatically, and stops on the time budget, end of book, Stop, or unmount.
//
// Audio engine: the native Android TextToSpeech plugin on Capacitor (the
// WebView's Web Speech API produces no sound there), and the Web Speech API on
// the web (where it works well).
export function useReadAloud({ getView, lang }) {
  const [reading, setReading] = useState(false);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const wakeLockRef = useRef(null);

  // Web: keep the screen awake during reading so it doesn't auto-sleep (which
  // suspends the Web Speech API). Re-acquired when the tab becomes visible
  // again, since the lock is dropped while hidden. (Native uses the OS TTS,
  // which keeps playing regardless.)
  const acquireWakeLock = useCallback(async () => {
    if (IS_NATIVE) return;
    try { wakeLockRef.current = await navigator.wakeLock?.request('screen'); } catch {}
  }, []);
  const releaseWakeLock = useCallback(() => {
    try { wakeLockRef.current?.release?.(); } catch {}
    wakeLockRef.current = null;
  }, []);

  const stop = useCallback(() => {
    stopRef.current = true;
    if (IS_NATIVE) { try { TextToSpeech.stop(); } catch {} }
    else { try { window.speechSynthesis.cancel(); } catch {} }
    setReading(false);
  }, []);

  // getVoices() is async in Chromium: empty until 'voiceschanged'. Web only.
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

  // Native: hand the text to the OS TextToSpeech engine, which resolves when
  // done and has no length/gesture limits.
  const speakNative = useCallback(async (text) => {
    try {
      await TextToSpeech.speak({ text, lang: lang || 'es-ES', rate: 1.0 });
    } catch { /* missing voice/engine — skip this block */ }
  }, [lang]);

  // Web: Web Speech API with a pause/resume keep-alive (Chromium stops
  // utterances longer than ~15s).
  const speakWeb = useCallback((text, voices) => new Promise((resolve) => {
    const ss = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    const prefix = lang ? String(lang).toLowerCase().split('-')[0] : '';
    const voice = prefix ? voices.find(v => v.lang?.toLowerCase().startsWith(prefix)) : null;
    if (voice) u.voice = voice;
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
    await acquireWakeLock();
    const onVisible = () => { if (document.visibilityState === 'visible' && runningRef.current) acquireWakeLock(); };
    document.addEventListener('visibilitychange', onVisible);
    const deadline = performance.now() + minutes * 60_000;
    const voices = IS_NATIVE ? null : await ensureVoices();
    const speak = (text) => (IS_NATIVE ? speakNative(text) : speakWeb(text, voices));
    try {
      await view.initTTS('sentence');
      // Start at the block under the current page; fall back to the section start.
      let ssml = view.lastLocation?.range
        ? view.tts.from(view.lastLocation.range)
        : view.tts.start();

      while (!stopRef.current && performance.now() < deadline) {
        const text = ssmlToText(ssml);
        if (text) {
          await speak(text);
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
      document.removeEventListener('visibilitychange', onVisible);
      releaseWakeLock();
      if (IS_NATIVE) { try { TextToSpeech.stop(); } catch {} }
      else { try { window.speechSynthesis.cancel(); } catch {} }
      if (mountedRef.current) setReading(false);
    }
  }, [getView, speakNative, speakWeb, acquireWakeLock, releaseWakeLock]);

  useEffect(() => () => {
    mountedRef.current = false;
    stopRef.current = true;
    try { wakeLockRef.current?.release?.(); } catch {}
    if (IS_NATIVE) { try { TextToSpeech.stop(); } catch {} }
    else { try { window.speechSynthesis.cancel(); } catch {} }
  }, []);

  return { reading, start, stop };
}
