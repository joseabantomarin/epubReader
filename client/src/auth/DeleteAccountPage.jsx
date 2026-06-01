import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import GoogleSignInButton from './GoogleSignInButton.jsx';
import loginStyles from './login.module.css';
import styles from './deleteAccount.module.css';

export default function DeleteAccountPage() {
  const { user, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [deleted, setDeleted] = useState(false);

  // Terminal state takes precedence: after a successful delete we call logout(),
  // which clears `user`, so without this flag the page would fall back to the
  // sign-in prompt and look like nothing happened.
  if (deleted) {
    return (
      <div className={loginStyles.page}>
        <div className={loginStyles.card}>
          <h1 className={loginStyles.title}>Cuenta eliminada</h1>
          <p className={loginStyles.lead}>
            Tu cuenta y todos tus datos se eliminaron de forma permanente.
          </p>
          <Link to="/" className={styles.homeLink}>Volver al inicio</Link>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={loginStyles.page}>
        <div className={loginStyles.card}>
          <h1 className={loginStyles.title}>Eliminar cuenta</h1>
          <p className={loginStyles.lead}>
            Inicia sesión para eliminar tu cuenta y todos tus datos.
          </p>
          <GoogleSignInButton
            className={loginStyles.btnSlot}
            nativeClassName={loginStyles.nativeBtn}
            onSuccess={() => {}}
          />
        </div>
      </div>
    );
  }

  const canDelete = email.trim().toLowerCase() === (user.email || '').trim().toLowerCase();

  const onDelete = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount(email.trim());
      logout();
      setDeleted(true);
    } catch (e) {
      setError(
        e?.body?.error === 'email_mismatch'
          ? 'El correo no coincide con tu cuenta.'
          : 'No se pudo eliminar la cuenta. Inténtalo de nuevo.'
      );
      setDeleting(false);
    }
  };

  return (
    <div className={loginStyles.page}>
      <div className={loginStyles.card}>
        <h1 className={loginStyles.title}>Eliminar cuenta</h1>
        <p className={loginStyles.lead}>
          Esta acción es permanente. Se eliminarán tu cuenta y todos tus datos:
          libros, anotaciones, valoraciones, grupos y los libros que hayas
          compartido. No se puede deshacer.
        </p>
        <p className={styles.confirmHint}>
          Para confirmar, escribe tu correo <strong>{user.email}</strong>.
        </p>
        <input
          className={styles.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@correo.com"
          autoComplete="off"
          aria-label="Confirma tu correo"
        />
        <button
          className={styles.dangerBtn}
          onClick={onDelete}
          disabled={!canDelete || deleting}
        >
          {deleting ? 'Eliminando…' : 'Eliminar mi cuenta'}
        </button>
        <Link to="/" className={styles.cancelLink}>Cancelar</Link>
        {error && <p className={loginStyles.error}>{error}</p>}
      </div>
    </div>
  );
}
