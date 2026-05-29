import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './library.module.css';
import { api } from '../lib/api.js';
import { isPdfFile, extractPdfMeta } from '../lib/pdfMeta.js';
import { useFullscreen } from '../lib/useFullscreen.js';
import FullscreenButton from '../lib/FullscreenButton.jsx';
import PitchSection from '../lib/PitchSection.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import Toolbar from './Toolbar.jsx';
import BookCard from './BookCard.jsx';
import SettingsModal from './SettingsModal.jsx';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, toggleFullscreen] = useFullscreen();

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      setBooks(await api.listBooks());
      setError(null);
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Silently refresh when the tab regains focus so cover percentages
  // catch up with anything saved by the reader via keepalive.
  useEffect(() => {
    const refresh = () => reload({ silent: true });
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

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
      let extras = {};
      if (await isPdfFile(file)) {
        try {
          const meta = await extractPdfMeta(file);
          extras = { title: meta.title, author: meta.author, cover: meta.cover };
        } catch (err) {
          console.warn('[pdf] metadata extraction failed', err);
        }
      }
      const created = await api.uploadBook(file, extras);
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
        <div className={styles.brand}>
          <img src="/favicon.svg" alt="" className={styles.logo} width="32" height="32" />
          <h1 className={styles.title}>MisLibros</h1>
        </div>
        <div className={styles.userBox}>
          <FullscreenButton className={styles.iconBtn} isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
          <button
            className={styles.iconBtn}
            onClick={() => setSettingsOpen(true)}
            aria-label="Ajustes del lector"
            title="Ajustes del lector"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
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

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <hr className={styles.divider} />
      <PitchSection />
    </main>
  );
}
