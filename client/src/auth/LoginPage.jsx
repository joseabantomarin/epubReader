import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import styles from './login.module.css';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = GSI_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const btnRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !btnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: async ({ credential }) => {
          try {
            await loginWithGoogle(credential);
            navigate('/', { replace: true });
          } catch (e) {
            setError('No se pudo iniciar sesión. Inténtalo de nuevo.');
          }
        },
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with',
      });
    }).catch(() => setError('No se pudo cargar Google Sign-In.'));
    return () => { cancelled = true; };
  }, [loginWithGoogle, navigate]);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <img src="/favicon.svg" alt="" width="96" height="96" className={styles.logo} />
        <h1 className={styles.title}>MisLibros</h1>
        <p className={styles.tagline}>Tu biblioteca personal en la nube.</p>
        <p className={styles.lead}>
          Lee EPUB y PDF desde cualquier dispositivo. Tu progreso se
          sincroniza automáticamente — empieza un libro en tu computadora
          y termínalo en el celular.
        </p>
        <div ref={btnRef} className={styles.btnSlot} />
        {error && <p className={styles.error}>{error}</p>}
      </div>

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
        openlinks.app
      </a>
    </main>
  );
}
