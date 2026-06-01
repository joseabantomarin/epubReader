import { useEffect, useState } from 'react';
import styles from './settings.module.css';
import { api } from '../lib/api.js';

// Choose how to share the selected book(s): public, a group, or one person.
// `ids` are the selected book ids. onShared(mode, result) fires after success.
export default function ShareDialog({ open, ids = [], count, onClose, onShared }) {
  const [mode, setMode] = useState('public');
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setMode('public'); setEmail(''); setError(null); setGroupId(null);
    api.listGroups()
      .then((gs) => {
        // Any group you belong to (owner or member) — members can publish too.
        setGroups(gs);
        if (gs.length) setGroupId(gs[0].id);
      })
      .catch(() => setGroups([]));
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      let result;
      if (mode === 'public') result = await api.shareBooks(ids, 'public');
      else if (mode === 'group') {
        if (!groupId) { setError('Elige un grupo.'); setBusy(false); return; }
        result = await api.shareBooks(ids, 'group', { targetId: groupId });
      } else {
        const e = email.trim();
        if (!e) { setError('Escribe un correo.'); setBusy(false); return; }
        result = await api.shareBooks(ids, 'user', { email: e });
      }
      onShared(mode, result);
    } catch (err) {
      setError(err?.status === 404 && mode === 'user'
        ? 'Ese correo no tiene cuenta todavía.'
        : 'No se pudo compartir.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Compartir">
        <header className={styles.header}>
          <h2 className={styles.title}>Compartir {count > 1 ? `(${count})` : ''}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className={styles.body}>
          <div className={styles.chips}>
            <button className={`${styles.chip} ${mode === 'public' ? styles.chipActive : ''}`} onClick={() => setMode('public')}>Público</button>
            <button className={`${styles.chip} ${mode === 'group' ? styles.chipActive : ''}`} onClick={() => setMode('group')}>Grupo</button>
            <button className={`${styles.chip} ${mode === 'user' ? styles.chipActive : ''}`} onClick={() => setMode('user')}>Individual</button>
          </div>

          {mode === 'group' && (
            groups.length === 0
              ? <p style={{ marginTop: 12 }}>No perteneces a ningún grupo todavía. Crea uno en "Mis grupos".</p>
              : <select style={{ marginTop: 12, width: '100%', padding: 8 }}
                  value={groupId ?? ''} onChange={(e) => setGroupId(Number(e.target.value))}>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
          )}

          {mode === 'user' && (
            <input type="email" placeholder="correo@ejemplo.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ marginTop: 12, width: '100%', padding: 8, boxSizing: 'border-box' }} />
          )}

          {error && <p style={{ color: '#b00020', marginTop: 10 }}>{error}</p>}
        </div>
        <footer className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancelar</button>
          <button className={styles.btnPrimary} onClick={submit} disabled={busy}>
            {busy ? 'Compartiendo…' : 'Compartir'}
          </button>
        </footer>
      </div>
    </div>
  );
}
