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
        <h1 className={styles.title}>epubReader</h1>
        <p className={styles.sub}>Tus libros, sincronizados donde sea.</p>
        <div ref={btnRef} className={styles.btnSlot} />
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </main>
  );
}
