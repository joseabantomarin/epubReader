import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import SharedShelf from '../library/SharedShelf.jsx';
import styles from './groups.module.css';

export default function GroupDetailPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  const refresh = () => api.getGroup(groupId).then(setGroup).catch(() => navigate('/grupos'));
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [groupId]);

  if (!group) return <div className={styles.page}><p className={styles.empty}>Cargando…</p></div>;
  const isOwner = group.role === 'owner';

  const addMember = async () => {
    const e = email.trim();
    if (!e) return;
    setError(null);
    try { await api.addGroupMember(group.id, e); setEmail(''); refresh(); }
    catch (err) { setError(err?.status === 409 ? 'Ya está en el grupo.' : 'No se pudo agregar.'); }
  };
  const removeMember = async (mid) => { await api.removeGroupMember(group.id, mid); refresh(); };
  const rename = async () => {
    const n = prompt('Nuevo nombre del grupo', group.name);
    if (n && n.trim()) { await api.renameGroup(group.id, n.trim()); refresh(); }
  };
  const remove = async () => {
    if (confirm('¿Borrar este grupo? Los libros compartidos a él volverán a privados.')) {
      await api.deleteGroup(group.id); navigate('/grupos');
    }
  };
  const leave = async () => {
    if (confirm('¿Salir de este grupo?')) { await api.leaveGroup(group.id); navigate('/grupos'); }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/grupos')} aria-label="Volver">←</button>
        <h1 className={styles.title}>{group.name}</h1>
        {isOwner
          ? <div className={styles.headerActions}>
              <button className={styles.linkBtn} onClick={rename}>Renombrar</button>
              <button className={styles.dangerBtn} onClick={remove}>Borrar</button>
            </div>
          : <button className={styles.linkBtn} onClick={leave}>Salir</button>}
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Miembros</h2>
        {isOwner && (
          <div className={styles.createRow}>
            <input type="email" value={email} placeholder="correo@ejemplo.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }} />
            <button className={styles.primary} onClick={addMember}>Agregar</button>
          </div>
        )}
        {error && <p style={{ color: '#b00020' }}>{error}</p>}
        <ul className={styles.list}>
          {group.members.map(m => (
            <li key={m.id} className={styles.item}>
              <span className={styles.name}>{m.name || m.email}</span>
              <span className={styles.meta}>
                {m.status === 'pending' ? 'Pendiente' : 'Activo'}
                {isOwner && <button className={styles.linkBtn} onClick={() => removeMember(m.id)}>Quitar</button>}
              </span>
            </li>
          ))}
          {group.members.length === 0 && <p className={styles.empty}>Sin miembros aún.</p>}
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Libros del grupo</h2>
        <SharedShelf books={group.books} canRate={false} onOpen={(b) => navigate(`/read/${b.id}?shared=1`)} />
      </section>
    </div>
  );
}
