import { useRef } from 'react';
import styles from './library.module.css';

export default function Toolbar({
  query, onQueryChange,
  selectionMode, selectedCount,
  onAddFile,
  onEnterSelection, onCancelSelection, onDeleteSelected,
  uploading,
}) {
  const fileRef = useRef(null);
  return (
    <div className={styles.toolbar}>
      <input
        className={styles.search}
        type="search"
        placeholder="🔍 Buscar por título o autor..."
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <div className={styles.toolbarButtons}>
        {!selectionMode ? (
          <>
            <button className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => fileRef.current.click()} disabled={uploading}>
              {uploading ? <><span className={styles.spinner} />Subiendo…</> : '＋ Agregar'}
            </button>
            <button className={styles.btn} onClick={onEnterSelection}>☑ Seleccionar</button>
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
              🗑 Eliminar ({selectedCount})
            </button>
            <button className={styles.btn} onClick={onCancelSelection}>Cancelar</button>
          </>
        )}
      </div>
    </div>
  );
}
