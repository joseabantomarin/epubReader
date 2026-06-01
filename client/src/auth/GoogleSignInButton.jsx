import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { useAuth } from './AuthContext.jsx';

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

export default function GoogleSignInButton({ className, nativeClassName, onSuccess }) {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const btnRef = useRef(null);
  const [error, setError] = useState(null);
  const [signingIn, setSigningIn] = useState(false);

  // After a successful login, call onSuccess if the caller provided one;
  // otherwise fall back to the default behavior of landing on the library.
  // Held in a ref so the GSI init effect below doesn't re-run on every render.
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const afterLogin = (user) => {
    if (onSuccessRef.current) onSuccessRef.current(user);
    else navigate('/', { replace: true });
  };

  useEffect(() => {
    if (IS_NATIVE) {
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
            const user = await loginWithGoogle(credential);
            afterLogin(user);
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
      if (!credential) throw new Error('plugin returned no idToken');
      const u = await loginWithGoogle(credential);
      afterLogin(u);
    } catch (e) {
      console.error('[native sign-in]', e);
      const detail = e?.code != null ? `code ${e.code}` : (e?.message || String(e));
      setError(`Falló el login: ${detail}`);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <>
      {IS_NATIVE ? (
        <button className={nativeClassName} onClick={nativeSignIn} disabled={signingIn}>
          {signingIn ? 'Iniciando…' : 'Iniciar sesión con Google'}
        </button>
      ) : (
        <div ref={btnRef} className={className} />
      )}
      {error && <p style={{ color: '#b00020', marginTop: 8 }}>{error}</p>}
    </>
  );
}
