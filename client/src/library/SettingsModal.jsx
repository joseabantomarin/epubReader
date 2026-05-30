import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import styles from './settings.module.css';
import { DEFAULTS, loadSettings, saveSettings } from '../lib/readerSettings.js';

const IS_NATIVE = Capacitor.isNativePlatform();

const FONT_FAMILY_OPTIONS = [
  { value: 'system', label: 'Sistema' },
  { value: 'serif', label: 'Serif (Georgia)' },
  { value: 'sans-serif', label: 'Sans-serif (Helvetica)' },
  { value: 'monospace', label: 'Monoespaciada' },
];

const THEME_OPTIONS = [
  { value: 'auto', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Oscuro' },
];

export default function SettingsModal({ open, onClose }) {
  const [s, setS] = useState(loadSettings);

  useEffect(() => { if (open) setS(loadSettings()); }, [open]);

  if (!open) return null;

  const update = (patch) => setS((prev) => {
    const next = { ...prev, ...patch };
    saveSettings(next);
    return next;
  });

  const reset = () => { saveSettings(DEFAULTS); setS({ ...DEFAULTS }); };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ajustes del lector">
        <header className={styles.header}>
          <h2 className={styles.title}>Ajustes del lector</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <div className={styles.body}>
          <section className={styles.row}>
            <label className={styles.label}>Tamaño de fuente</label>
            <div className={styles.sliderRow}>
              <input
                type="range" min="60" max="200" step="10"
                value={s.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
              />
              <span className={styles.value}>{s.fontSize}%</span>
            </div>
          </section>

          <section className={styles.row}>
            <label className={styles.label}>Familia tipográfica</label>
            <div className={styles.chips}>
              {FONT_FAMILY_OPTIONS.map((o) => (
                <button key={o.value}
                  className={`${styles.chip} ${s.fontFamily === o.value ? styles.chipActive : ''}`}
                  onClick={() => update({ fontFamily: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.row}>
            <label className={styles.label}>Tema</label>
            <div className={styles.chips}>
              {THEME_OPTIONS.map((o) => (
                <button key={o.value}
                  className={`${styles.chip} ${s.theme === o.value ? styles.chipActive : ''}`}
                  onClick={() => update({ theme: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.row}>
            <label className={styles.label}>Alto del interlineado</label>
            <div className={styles.sliderRow}>
              <input
                type="range" min="1.0" max="2.2" step="0.1"
                value={s.lineHeight}
                onChange={(e) => update({ lineHeight: Number(e.target.value) })}
              />
              <span className={styles.value}>{s.lineHeight.toFixed(1)}</span>
            </div>
          </section>

          <section className={styles.row}>
            <label className={styles.label}>Separación de sílabas</label>
            <div className={styles.chips}>
              <button
                className={`${styles.chip} ${s.hyphenation ? styles.chipActive : ''}`}
                onClick={() => update({ hyphenation: true })}>Activada</button>
              <button
                className={`${styles.chip} ${!s.hyphenation ? styles.chipActive : ''}`}
                onClick={() => update({ hyphenation: false })}>Desactivada</button>
            </div>
          </section>

          {!IS_NATIVE && (
            <section className={styles.row}>
              <label className={styles.label}>Mano dominante</label>
              <div className={styles.chips}>
                <button
                  className={`${styles.chip} ${s.handedness === 'right' ? styles.chipActive : ''}`}
                  onClick={() => update({ handedness: 'right' })}>Diestro</button>
                <button
                  className={`${styles.chip} ${s.handedness === 'left' ? styles.chipActive : ''}`}
                  onClick={() => update({ handedness: 'left' })}>Zurdo</button>
              </div>
            </section>
          )}

          <p className={styles.hint}>Los cambios se aplican la próxima vez que abras un libro.</p>
        </div>

        <footer className={styles.footer}>
          <button className={styles.btnSecondary} onClick={reset}>Restablecer</button>
          <button className={styles.btnPrimary} onClick={onClose}>Listo</button>
        </footer>
      </div>
    </div>
  );
}
