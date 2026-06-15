import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import styles from './PitchSection.module.css';

const PAYPAL_URL = 'https://www.paypal.com/ncp/payment/VZ3CFJK4YDBML';
// Voluntary support (Yape QR and PayPal) is web only. App stores require their
// own in-app purchase flow for donations, so hide the whole support button and
// modal on native. Show them on web only.
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

      {!IS_NATIVE && (
        <>
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

                <div className={styles.qrBlock}>
                  <span className={styles.method}>Yape (Perú)</span>
                  <img
                    className={styles.qr}
                    src="/yape-qr.png"
                    alt="Código QR de Yape, Jose Roberto Abanto Marin"
                  />
                  <span className={styles.qrHint}>Escanéalo desde otro dispositivo con la app Yape.</span>
                </div>

                <div className={styles.paypalBlock}>
                  <span className={styles.method}>Internacional</span>
                  <a className={styles.paypalBtn} href={PAYPAL_URL} target="_blank" rel="noopener noreferrer">
                    Donar con PayPal
                  </a>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
