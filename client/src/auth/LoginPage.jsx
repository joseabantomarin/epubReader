import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { useAuth } from './AuthContext.jsx';
import styles from './login.module.css';
import PitchSection from '../lib/PitchSection.jsx';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const IS_NATIVE = Capacitor.isNativePlatform();

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
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (IS_NATIVE) {
      // Native plugin reads serverClientId from capacitor.config.json
      try { GoogleAuth.initialize(); } catch (e) { console.warn('GoogleAuth init', e); }
      return;
    }
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

  const nativeSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const user = await GoogleAuth.signIn();
      const credential = user.authentication?.idToken;
      if (!credential) throw new Error('no id_token returned');
      await loginWithGoogle(credential);
      navigate('/', { replace: true });
    } catch (e) {
      console.error('[native sign-in]', e);
      setError('No se pudo iniciar sesión. Inténtalo de nuevo.');
    } finally {
      setSigningIn(false);
    }
  };

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
        {IS_NATIVE ? (
          <button className={styles.nativeBtn} onClick={nativeSignIn} disabled={signingIn}>
            {signingIn ? 'Iniciando…' : 'Iniciar sesión con Google'}
          </button>
        ) : (
          <div ref={btnRef} className={styles.btnSlot} />
        )}
        {error && <p className={styles.error}>{error}</p>}
      </div>

      <PitchSection />
    </main>
  );
}
