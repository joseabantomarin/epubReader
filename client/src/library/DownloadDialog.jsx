import { X } from 'lucide-react';
import styles from './settings.module.css';
import { bookDownloadUrl } from '../lib/api.js';
import { triggerDownload } from '../lib/download.js';

// Elegir el formato de descarga de un libro EPUB. Para libros que ya son PDF
// la biblioteca descarga directamente, sin abrir este diálogo.
export default function DownloadDialog({ open, book, onClose }) {
  if (!open || !book) return null;

  const download = (pdf) => {
    triggerDownload(bookDownloadUrl(book.id, { pdf }));
    onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Descargar libro">
        <header className={styles.header}>
          <h2 className={styles.title}>Descargar</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar"><X size={18} strokeWidth={2} /></button>
        </header>
        <div className={styles.body}>
          <div className={styles.chips}>
            <button className={styles.chip} onClick={() => download(false)}>EPUB (original)</button>
            <button className={styles.chip} onClick={() => download(true)}>PDF (convertido)</button>
          </div>
          <p className={styles.hint}>
            La conversión a PDF puede tardar unos segundos la primera vez.
          </p>
        </div>
      </div>
    </div>
  );
}
