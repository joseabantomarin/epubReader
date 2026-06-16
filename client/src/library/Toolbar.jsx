import { useRef } from 'react';
import { Search, Plus, CheckSquare, Trash2, Share2, X } from 'lucide-react';
import styles from './library.module.css';

export default function Toolbar({
  query, onQueryChange,
  selectionMode, selectedCount,
  onAddFile,
  onEnterSelection, onCancelSelection, onDeleteSelected,
  onShareSelected, onUnshareSelected,
  uploading,
}) {
  const fileRef = useRef(null);
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchWrap}>
        <Search className={styles.searchIcon} size={18} strokeWidth={2} aria-hidden />
        <input
          className={styles.search}
          type="search"
          placeholder="Buscar por título o autor..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      <div className={styles.toolbarButtons}>
        {!selectionMode ? (
          <>
            <button className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => fileRef.current.click()} disabled={uploading}>
              {uploading ? <><span className={styles.spinner} />Subiendo…</> : <><Plus size={16} strokeWidth={2} aria-hidden /> Agregar</>}
            </button>
            <button className={styles.btn} onClick={onEnterSelection}><CheckSquare size={16} strokeWidth={2} aria-hidden /> Seleccionar</button>
            <input
              ref={fileRef} type="file" accept=".epub,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onAddFile(f);
                e.target.value = '';
              }}
            />
          </>
        ) : (
          <>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={onDeleteSelected}
              disabled={selectedCount === 0}
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden /> Eliminar ({selectedCount})
            </button>
            <button
              className={styles.btn}
              onClick={onShareSelected}
              disabled={selectedCount === 0}
            >
              <Share2 size={16} strokeWidth={2} aria-hidden /> Compartir ({selectedCount})
            </button>
            <button
              className={styles.btn}
              onClick={onUnshareSelected}
              disabled={selectedCount === 0}
            >
              <X size={16} strokeWidth={2} aria-hidden /> Dejar de compartir ({selectedCount})
            </button>
            <button className={styles.btn} onClick={onCancelSelection}>Cancelar</button>
          </>
        )}
      </div>
    </div>
  );
}
