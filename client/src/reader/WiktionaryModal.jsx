import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import styles from './annotations.module.css';

// MediaWiki action API works on every Wiktionary host. We pull the page extract
// (plain text intro) for the term and parse the leading lines.
async function lookup(term, lang) {
  const host = `https://${lang}.wiktionary.org`;
  const url = `${host}/w/api.php?action=query&format=json&origin=*&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(term)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('wiktionary_http_' + res.status);
  const data = await res.json();
  const pages = data?.query?.pages || {};
  const first = Object.values(pages)[0];
  if (!first || first.missing !== undefined || !first.extract) return null;
  return first.extract;
}

// Split a Wiktionary extract into (definitions, partOfSpeech). Heuristic: lines
// that start with a Spanish POS heading ("Sustantivo", "Verbo", "Adjetivo"…)
// are markers, and the lines under them are definitions.
function parse(extract) {
  if (!extract) return { defs: [], pos: '' };
  const lines = extract.split('\n').map(l => l.trim()).filter(Boolean);
  const defs = [];
  let pos = '';
  for (const l of lines) {
    if (/^=+\s/.test(l) || /^(Sustantivo|Verbo|Adjetivo|Adverbio|Pronombre|Noun|Verb|Adjective)/i.test(l)) {
      if (!pos) pos = l.replace(/^=+\s*|\s*=+$/g, '');
      continue;
    }
    if (/^\d+\s/.test(l) || l.length > 8) defs.push(l.replace(/^\d+\s*/, ''));
    if (defs.length >= 6) break;
  }
  return { defs, pos };
}

export default function WiktionaryModal({ open, term, lang = 'es', onClose }) {
  const [state, setState] = useState({ loading: true, error: null, defs: [], pos: '' });
  const [currentLang, setCurrentLang] = useState(lang);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ loading: true, error: null, defs: [], pos: '' });
    (async () => {
      try {
        let extract = await lookup(term, currentLang);
        // Many Spanish books contain proper nouns or English loanwords. Try EN.
        if (!extract && currentLang !== 'en') extract = await lookup(term, 'en');
        if (cancelled) return;
        if (!extract) {
          setState({ loading: false, error: 'No se encontró en Wiktionary.', defs: [], pos: '' });
          return;
        }
        const { defs, pos } = parse(extract);
        setState({
          loading: false, error: null,
          defs: defs.length ? defs : [extract.slice(0, 600)],
          pos,
        });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: 'Error al consultar Wiktionary.', defs: [], pos: '' });
      }
    })();
    return () => { cancelled = true; };
  }, [open, term, currentLang]);

  if (!open) return null;
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div>
            <p className={styles.dictWord}>{term}</p>
            {state.pos && <p className={styles.dictPos}>{state.pos}</p>}
          </div>
          <button className={styles.modalClose} onClick={onClose} aria-label="Cerrar"><X size={18} strokeWidth={2} /></button>
        </header>
        <div className={styles.modalBody}>
          {state.loading && <p>Buscando…</p>}
          {!state.loading && state.error && (
            <>
              <p className={styles.dictEmpty}>{state.error}</p>
              {currentLang !== 'en' && (
                <button className={styles.btnSecondary} onClick={() => setCurrentLang('en')}>
                  Probar en inglés
                </button>
              )}
            </>
          )}
          {!state.loading && !state.error && (
            <ol className={styles.dictDef}>
              {state.defs.map((d, i) => <li key={i}>{d}</li>)}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
