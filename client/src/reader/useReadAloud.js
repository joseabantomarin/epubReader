import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech';

const IS_NATIVE = Capacitor.isNativePlatform();
const MAX_PAGES = 100;

// Text of the current page (foliate exposes the visible range on lastLocation).
function pageText(view) {
  try {
    const t = view.lastLocation?.range?.toString() || '';
    return t.replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Split a page's text into short, sentence-sized chunks (<= ~160 chars). Long
// single utterances make Chrome's Web Speech engine cut out after a few seconds
// ("reads the first paragraph and stops"); short ones play through reliably.
function chunkText(text, maxLen = 160) {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const out = [];
  let cur = '';
  const flush = () => { const t = cur.trim(); if (t) out.push(t); cur = ''; };
  for (const raw of sentences) {
    let s = raw.trim();
    if (!s) continue;
    // Hard-split a very long run with no sentence punctuation.
    while (s.length > maxLen) {
      let cut = s.lastIndexOf(' ', maxLen);
      if (cut <= 0) cut = maxLen;
      if (cur) flush();
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (!cur) cur = s;
    else if ((cur + ' ' + s).length <= maxLen) cur += ' ' + s;
    else { flush(); cur = s; }
  }
  flush();
  return out;
}

// Reads aloud N pages from the CURRENT page, advancing the view in sync.
// - Web: live loop (read page → speak → next). The wake lock keeps the screen
//   on so the Web Speech API isn't suspended.
// - Native (Android): the WebView freezes JS when the screen is off, so we
//   extract the N pages up front, queue them all on the native TextToSpeech
//   engine (keeps playing with the screen off), and a follower advances one
//   page each time a page's audio finishes (catches up after the screen wakes).
export function useReadAloud({ getView, lang }) {
  const [reading, setReading] = useState(false);
  const [preparing, setPreparing] = useState(false);
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
    // Prefer a local (offline) voice for the language — network voices cut out.
    let voice = null;
    if (prefix) {
      const matches = voices.filter(v => v.lang?.toLowerCase().startsWith(prefix));
      voice = matches.find(v => v.localService) || matches[0] || null;
    }
    if (voice) u.voice = voice;
    let keepAlive = null;
    let watchdog = null;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (pendingResolveRef.current === done) pendingResolveRef.current = null;
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    pendingResolveRef.current = done;
    ss.speak(u);
    // Chrome can silently auto-pause synthesis; a periodic resume() (a no-op
    // when not paused) keeps it going without the risky pause()/resume() pair.
    keepAlive = setInterval(() => {
      if (!ss.speaking && !ss.pending) { clearInterval(keepAlive); keepAlive = null; return; }
      try { ss.resume(); } catch {}
    }, 5000);
    // Safety net: never hang the loop if neither onend nor onerror ever fires.
    watchdog = setTimeout(done, Math.max(6000, text.length * 120) + 4000);
  }), [lang]);

  // Advance the rendered view by one page; returns false if it couldn't (end).
  const nextPage = async (view) => {
    const before = view.renderer?.start;
    try { await view.next(); } catch {}
    await wait(120);
    return view.renderer?.start !== before;
  };

  // Web: live page-by-page loop. Each page is spoken as several short chunks so
  // the engine never hits Chrome's long-utterance cutoff.
  const startWebPages = useCallback(async (view, pages) => {
    const voices = await ensureVoices();
    try { window.speechSynthesis.cancel(); } catch {} // clear any stale queue
    for (let i = 0; i < pages && !stopRef.current; i++) {
      const t = pageText(view);
      if (t) {
        for (const chunk of chunkText(t)) {
          if (stopRef.current) break;
          await speakWeb(chunk, voices);
        }
        if (stopRef.current) break;
      }
      if (!(await nextPage(view))) break;
    }
  }, [speakWeb]);

  // Native: extract N pages, queue them, follow with one page-turn per page.
  const startNative = useCallback(async (view, pages) => {
    setPreparing(true);
    // Clear any audio still queued from a previous run (the page "cache") so a
    // new session always starts clean and never replays leftover pages.
    try { await TextToSpeech.stop(); } catch {}
    await wait(200);

    // 1) Extract the text of the next N pages by walking the view (masked by an
    //    overlay), then return to the starting page.
    const startCfi = view.lastLocation?.cfi || null;
    const texts = [];
    for (let i = 0; i < pages && !stopRef.current; i++) {
      const t = pageText(view);
      if (t) texts.push(t);
      if (i < pages - 1 && !(await nextPage(view))) break; // stop at end of book
    }

    // Return to the starting page. goTo() by CFI can land one page early in the
    // Android WebView, so playback looks like it begins "a bit before" the page
    // on screen; nudge forward until the visible page matches the first one read.
    if (startCfi) {
      try { await view.goTo(startCfi); } catch {}
      await wait(150);
      const target = texts[0];
      for (let k = 0; k < 3 && target && pageText(view) !== target; k++) {
        if (!(await nextPage(view))) break;
      }
    }
    setPreparing(false);
    if (!texts.length || stopRef.current) return;

    // 2) Queue every page so the native engine plays through with the screen off.
    const proms = texts.map(t => TextToSpeech.speak({
      text: t, lang: lang || 'es-ES', rate: 1.0, queueStrategy: QueueStrategy.Add,
    }).catch(() => {}));

    // 3) Follow: turn one page each time a page's audio finishes (frozen while
    //    the screen is off; catches up in a burst when it wakes).
    (async () => {
      for (let i = 0; i < proms.length - 1; i++) {
        await proms[i];
        if (stopRef.current) return;
        await nextPage(view);
      }
    })();

    // 4) Resolve when the last page finishes or stop() is pressed.
    await new Promise((resolve) => {
      let settled = false;
      const done = () => { if (settled) return; settled = true; pendingResolveRef.current = null; resolve(); };
      pendingResolveRef.current = done;
      proms[proms.length - 1].then(done, done);
    });
  }, [lang]);

  const start = useCallback(async (pages) => {
    if (runningRef.current) return;
    const view = getView();
    if (!view) return;
    const n = Math.max(1, Math.min(MAX_PAGES, Math.round(pages) || 10));
    runningRef.current = true;
    stopRef.current = false;
    setReading(true);
    await acquireWakeLock();
    const onVisible = () => { if (document.visibilityState === 'visible' && runningRef.current) acquireWakeLock(); };
    document.addEventListener('visibilitychange', onVisible);
    try {
      if (IS_NATIVE) await startNative(view, n);
      else await startWebPages(view, n);
    } catch { /* best-effort */ }
    finally {
      runningRef.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      releaseWakeLock();
      setPreparing(false);
      if (IS_NATIVE) { try { TextToSpeech.stop(); } catch {} }
      else { try { window.speechSynthesis.cancel(); } catch {} }
      if (mountedRef.current) setReading(false);
    }
  }, [getView, startNative, startWebPages, acquireWakeLock, releaseWakeLock]);

  useEffect(() => () => {
    mountedRef.current = false;
    stopRef.current = true;
    try { wakeLockRef.current?.release?.(); } catch {}
    if (IS_NATIVE) { try { TextToSpeech.stop(); } catch {} }
    else { try { window.speechSynthesis.cancel(); } catch {} }
    pendingResolveRef.current?.();
  }, []);

  return { reading, preparing, start, stop, maxPages: MAX_PAGES };
}
