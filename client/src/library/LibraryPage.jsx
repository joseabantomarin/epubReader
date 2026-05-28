import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './library.module.css';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import Toolbar from './Toolbar.jsx';
import BookCard from './BookCard.jsx';

export default function LibraryPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setBooks(await api.listBooks());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return books;
    return books.filter(b =>
      (b.title || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q)
    );
  }, [books, query]);

  const handleAddFile = async (file) => {
    setUploading(true);
    try {
      const created = await api.uploadBook(file);
      setBooks((prev) => [created, ...prev]);
    } catch (e) {
      alert('No se pudo subir el libro: ' + (e.body?.error || e.message));
    } finally {
      setUploading(false);
    }
  };

  const enterSelection = () => { setSelectionMode(true); setSelectedIds(new Set()); };
  const cancelSelection = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`¿Eliminar ${ids.length} libro(s)? Esta acción no se puede deshacer.`)) return;
    try {
      await api.deleteBooks(ids);
      setBooks((prev) => prev.filter(b => !selectedIds.has(b.id)));
      cancelSelection();
    } catch (e) {
      alert('Error al eliminar: ' + e.message);
    }
  };

  const onActivate = (book) => {
    if (selectionMode) toggleSelect(book.id);
    else navigate(`/read/${book.id}`);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>epubReader</h1>
        <div className={styles.userBox}>
          {user?.picture && <img src={user.picture} alt="" className={styles.avatar} />}
          <button className={styles.logoutBtn} onClick={logout}>Salir</button>
        </div>
      </header>

      <Toolbar
        query={query}
        onQueryChange={setQuery}
        selectionMode={selectionMode}
        selectedCount={selectedIds.size}
        uploading={uploading}
        onAddFile={handleAddFile}
        onEnterSelection={enterSelection}
        onCancelSelection={cancelSelection}
        onDeleteSelected={deleteSelected}
      />

      {error && <p className={styles.empty} style={{ color: '#b00020' }}>{error}</p>}
      {loading ? (
        <p className={styles.empty}><span className={styles.spinner} />Cargando…</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>
          {books.length === 0
            ? 'Aún no tienes libros. Pulsa "Agregar" para subir tu primer EPUB.'
            : 'No hay coincidencias.'}
        </p>
      ) : (
        <div className={styles.grid}>
          {filtered.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              selectionMode={selectionMode}
              selected={selectedIds.has(b.id)}
              onActivate={onActivate}
            />
          ))}
        </div>
      )}
    </main>
  );
}
