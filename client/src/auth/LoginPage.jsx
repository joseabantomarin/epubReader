import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';
import styles from './login.module.css';
import PitchSection from '../lib/PitchSection.jsx';

export default function LoginPage() {
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) navigate('/', { replace: true });
  }, [token, navigate]);

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
        <GoogleSignInButton className={styles.btnSlot} nativeClassName={styles.nativeBtn} />
        <button className={styles.guestLink} onClick={() => navigate('/')}>
          Entrar sin iniciar sesión
        </button>
      </div>

      <PitchSection />
    </main>
  );
}
