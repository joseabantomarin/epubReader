import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech';

const IS_NATIVE = Capacitor.isNativePlatform();
const MAX_MINUTES = 100;            // hard cap on the read-aloud duration
const CHARS_PER_MIN = 900;          // rough Spanish TTS rate, to size the queue
const CHUNK_LEN = 3500;             // Android TTS per-utterance limit is ~4000

// foliate's TTS emits SSML (with <mark>/<break> elements). For web speech we
// only need the plain text — strip the SSML to its text content.
function ssmlToText(ssml) {
  if (!ssml || typeof ssml !== 'string') return '';
  try {
    const doc = new DOMParser().parseFromString(ssml, 'application/xml');
    return (doc.documentElement?.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// Split text into <= maxLen chunks, preferring sentence boundaries.
function chunkText(text, maxLen) {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > maxLen) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      if (s.length > maxLen) {
        for (let i = 0; i < s.length; i += maxLen) out.push(s.slice(i, i + maxLen).trim());
      } else cur = s;
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// Text of the current section from the current reading position to its end.
function currentSectionText(view) {
  try {
    const doc = view.renderer?.getContents?.()[0]?.doc;
    if (!doc?.body) return '';
    const r = view.lastLocation?.range;
    if (r?.startContainer) {
      const range = doc.createRange();
      range.setStart(r.startContainer, r.startOffset);
      range.setEnd(doc.body, doc.body.childNodes.length);
      const t = range.toString();
      if (t && t.trim()) return t;
    }
    return doc.body.innerText || '';
  } catch { return ''; }
}

// Reads aloud from the CURRENT page. Two engines:
// - Web: foliate's TTS block-by-block via the Web Speech API; foliate scrolls
//   the page to each block so the view follows the audio.
// - Native (Android): the WebView freezes JS when the screen is off, so we
//   can't drive playback block-by-block. Instead we extract the text for the
//   requested minutes up front (across sections) and queue it all on the native
//   TextToSpeech engine, which keeps playing with the screen off.
export function useReadAloud({ getView, lang }) {
  const [reading, setReading] = useState(false);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const wakeLockRef = useRef(null);
  const pendingResolveRef = useRef(null);

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
    pendingResolveRef.current?.();
    setReading(false);
  }, []);

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
    setTimeout(finish, 1000);
  });

  const speakWeb = useCallback((text, voices) => new Promise((resolve) => {
    const ss = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    const prefix = lang ? String(lang).toLowerCase().split('-')[0] : '';
    const voice = prefix ? voices.find(v => v.lang?.toLowerCase().startsWith(prefix)) : null;
    if (voice) u.voice = voice;
    let keepAlive = null;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
      if (pendingResolveRef.current === done) pendingResolveRef.current = null;
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    pendingResolveRef.current = done;
    ss.speak(u);
    keepAlive = setInterval(() => {
      if (!ss.speaking) { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } return; }
      ss.pause(); ss.resume();
    }, 10000);
  }), [lang]);

  // ── Native: gather text for the requested minutes and queue it all. ──
  const startNative = useCallback(async (view, minutes) => {
    try { await TextToSpeech.stop(); } catch {}
    const maxChars = minutes * CHARS_PER_MIN;
    const sections = view.book?.sections || [];
    const startIndex = (() => {
      try { return view.renderer.getContents()[0].index ?? 0; } catch { return 0; }
    })();
    let total = 0;
    const proms = [];
    const enqueue = (text) => {
      for (const chunk of chunkText(text, CHUNK_LEN)) {
        if (stopRef.current || total >= maxChars) return;
        total += chunk.length;
        // Do NOT await: fire-and-queue so the native engine buffers everything
        // and plays it back-to-back even while JS is frozen (screen off).
        proms.push(TextToSpeech.speak({
          text: chunk, lang: lang || 'es-ES', rate: 1.0, queueStrategy: QueueStrategy.Add,
        }).catch(() => {}));
      }
    };

    enqueue(currentSectionText(view));
    for (let i = startIndex + 1; i < sections.length && total < maxChars && !stopRef.current; i++) {
      let doc;
      try { doc = await sections[i].createDocument(); } catch { continue; }
      const t = (doc?.body?.innerText || '').replace(/\s+/g, ' ').trim();
      if (t) enqueue(t);
    }

    if (!proms.length) return;
    // Resolve when the last queued utterance finishes OR stop() fires.
    await new Promise((resolve) => {
      let settled = false;
      const done = () => { if (settled) return; settled = true; pendingResolveRef.current = null; resolve(); };
      pendingResolveRef.current = done;
      proms[proms.length - 1].then(done, done);
    });
  }, [lang]);

  // ── Web: foliate block-by-block with page-follow. ──
  const startWeb = useCallback(async (view, deadline) => {
    const voices = await ensureVoices();
    await view.initTTS('sentence');
    let ssml = view.lastLocation?.range ? view.tts.from(view.lastLocation.range) : view.tts.start();
    while (!stopRef.current && performance.now() < deadline) {
      const text = ssmlToText(ssml);
      if (text) {
        await speakWeb(text, voices);
        if (stopRef.current || performance.now() >= deadline) break;
      }
      let nextSsml = view.tts.next(true);
      if (nextSsml == null) {
        const before = view.renderer?.start;
        await view.next();
        await new Promise(r => setTimeout(r, 300));
        if (view.renderer?.start === before) break;
        await view.initTTS('sentence');
        nextSsml = view.tts.start();
        if (nextSsml == null) break;
      }
      ssml = nextSsml;
    }
  }, [speakWeb]);

  const start = useCallback(async (minutes) => {
    if (runningRef.current) return;
    const view = getView();
    if (!view || typeof view.initTTS !== 'function') return;
    const mins = Math.max(1, Math.min(MAX_MINUTES, Math.round(minutes) || 15));
    runningRef.current = true;
    stopRef.current = false;
    setReading(true);
    await acquireWakeLock();
    const onVisible = () => { if (document.visibilityState === 'visible' && runningRef.current) acquireWakeLock(); };
    document.addEventListener('visibilitychange', onVisible);
    try {
      if (IS_NATIVE) await startNative(view, mins);
      else await startWeb(view, performance.now() + mins * 60_000);
    } catch { /* best-effort */ }
    finally {
      runningRef.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      releaseWakeLock();
      if (IS_NATIVE) { try { TextToSpeech.stop(); } catch {} }
      else { try { window.speechSynthesis.cancel(); } catch {} }
      if (mountedRef.current) setReading(false);
    }
  }, [getView, startNative, startWeb, acquireWakeLock, releaseWakeLock]);

  useEffect(() => () => {
    mountedRef.current = false;
    stopRef.current = true;
    try { wakeLockRef.current?.release?.(); } catch {}
    if (IS_NATIVE) { try { TextToSpeech.stop(); } catch {} }
    else { try { window.speechSynthesis.cancel(); } catch {} }
    pendingResolveRef.current?.();
  }, []);

  return { reading, start, stop, maxMinutes: MAX_MINUTES };
}
