import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import styles from './PitchSection.module.css';

const PAYPAL_URL = 'https://www.paypal.com/ncp/payment/VZ3CFJK4YDBML';
const PLAYSTORE_URL = 'https://play.google.com/store/apps/details?id=app.openlinks.mislibros&pcampaignid=web_share';
// Yape is a Peru-only wallet shown as a QR to scan from another device, which
// makes no sense inside the Android app. Show it on web only; hide it on native.
const IS_NATIVE = Capacitor.isNativePlatform();

export default function PitchSection() {
  const [supportOpen, setSupportOpen] = useState(false);

  // Close the support modal with Escape.
  useEffect(() => {
    if (!supportOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setSupportOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [supportOpen]);

  return (
    <div className={styles.wrap}>
      {/* Get-the-app CTA — web only; pointless inside the Android app itself. */}
      {!IS_NATIVE && (
        <a
          className={styles.downloadApp}
          href={PLAYSTORE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg className={styles.downloadAppIcon} viewBox="0 0 512 512" width="22" height="22" aria-hidden="true">
            <path fill="currentColor" d="M325.3 234.3 104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6-58.9-34-65.7 64.5 65.7 64.5 60.1-34.7c18-14.3 18-46.5-1.2-60.3zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
          </svg>
          Descargar Aplicación
        </a>
      )}

      <aside className={styles.pitch}>
        <h2 className={styles.pitchTitle}>¿Te gustó esta app?</h2>
        <p className={styles.pitchBody}>
          Desarrollo software a medida — webs, apps móviles, automatizaciones, IA.
          Cuéntame tu idea y la convertimos en producto.
        </p>
        <a
          className={styles.pitchCta}
          href="mailto:joseabantomarin@gmail.com?subject=Cotización%20de%20proyecto"
        >
          Cotizar mi proyecto →
        </a>
        <p className={styles.pitchSign}>José Abanto · Desarrollador full-stack</p>
      </aside>

      <a className={styles.siteLink} href="https://openlinks.app" target="_blank" rel="noopener noreferrer">
        Conoce más en openlinks.app <span aria-hidden>↗</span>
      </a>

      <button type="button" className={styles.supportLink} onClick={() => setSupportOpen(true)}>
        <span aria-hidden>💚</span> Apóyanos voluntariamente <span aria-hidden>🙏</span>
      </button>

      {supportOpen && (
        <div className={styles.backdrop} onClick={() => setSupportOpen(false)}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
          >
            <header className={styles.modalHeader}>
              <h2 id="support-title" className={styles.modalTitle}>Apóyanos voluntariamente</h2>
              <button className={styles.modalClose} onClick={() => setSupportOpen(false)} aria-label="Cerrar">×</button>
            </header>

            <p className={styles.modalIntro}>
              Tu apoyo es totalmente voluntario y ayuda a mantener la app. ¡Gracias! 🙏
            </p>

            {!IS_NATIVE && (
              <div className={styles.qrBlock}>
                <span className={styles.method}>Yape (Perú)</span>
                <img
                  className={styles.qr}
                  src="/yape-qr.png"
                  alt="Código QR de Yape, Jose Roberto Abanto Marin"
                />
                <span className={styles.qrHint}>Escanéalo desde otro dispositivo con la app Yape.</span>
              </div>
            )}

            <div className={styles.paypalBlock}>
              <span className={styles.method}>Internacional</span>
              <a className={styles.paypalBtn} href={PAYPAL_URL} target="_blank" rel="noopener noreferrer">
                Donar con PayPal
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
