import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Heart, ExternalLink, ArrowRight, Download, X } from 'lucide-react';
import styles from './PitchSection.module.css';

const PAYPAL_URL = 'https://www.paypal.com/ncp/payment/VZ3CFJK4YDBML';
const PLAYSTORE_URL = 'https://play.google.com/store/apps/details?id=app.openlinks.mislibros&pcampaignid=web_share';
// APK público servido por nuestro server; siempre la última versión subida,
// puede ir por delante de la publicada en el Play Store.
const APK_URL = '/downloads/mislibros.apk';
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
      {/* Get-the-app CTA — web only; pointless inside the Android app itself.
          El botón entrega el APK directamente (siempre la última versión); el
          Play Store queda como alternativa secundaria. */}
      {!IS_NATIVE && (
        <a className={styles.downloadApp} href={APK_URL} download>
          <Download className={styles.downloadAppIcon} size={22} strokeWidth={2} aria-hidden />
          Descargar Aplicación
        </a>
      )}
      {!IS_NATIVE && (
        <a
          className={styles.apkLink}
          href={PLAYSTORE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          o descárgala desde Google Play
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
          Cotizar mi proyecto <ArrowRight size={16} strokeWidth={2} aria-hidden />
        </a>
        <p className={styles.pitchSign}>José Abanto · Desarrollador full-stack</p>
      </aside>

      <a className={styles.siteLink} href="https://openlinks.app" target="_blank" rel="noopener noreferrer">
        Conoce más en openlinks.app <ExternalLink size={15} strokeWidth={2} aria-hidden />
      </a>

      {!IS_NATIVE && (
        <>
          <button type="button" className={styles.supportLink} onClick={() => setSupportOpen(true)}>
            <Heart size={16} strokeWidth={2} aria-hidden /> Apóyanos voluntariamente
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
                  <button className={styles.modalClose} onClick={() => setSupportOpen(false)} aria-label="Cerrar"><X size={18} strokeWidth={2} /></button>
                </header>

                <p className={styles.modalIntro}>
                  Tu apoyo es totalmente voluntario y ayuda a mantener la app. ¡Gracias!
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
