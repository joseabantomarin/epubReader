import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import styles from './groups.module.css';

export default function GroupsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = () => api.listGroups().then(setGroups).catch(() => setGroups([])).finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    await api.createGroup(n);
    setName('');
    refresh();
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')} aria-label="Volver">←</button>
        <h1 className={styles.title}>Mis grupos</h1>
      </header>

      <div className={styles.createRow}>
        <input value={name} placeholder="Nombre del grupo" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
        <button className={styles.primary} onClick={create}>Crear</button>
      </div>

      {loading ? <p className={styles.empty}>Cargando…</p>
        : groups.length === 0 ? <p className={styles.empty}>Aún no tienes grupos.</p>
        : <ul className={styles.list}>
            {groups.map(g => (
              <li key={g.id} className={styles.item} onClick={() => navigate(`/grupos/${g.id}`)}>
                <span className={styles.name}>{g.name}</span>
                <span className={styles.meta}>
                  {g.role === 'owner' ? 'Dueño' : 'Miembro'} · {g.memberCount} miembro(s)
                </span>
              </li>
            ))}
          </ul>}
    </div>
  );
}
