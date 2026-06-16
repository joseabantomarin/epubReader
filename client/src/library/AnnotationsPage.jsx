import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import styles from './annotationsPage.module.css';

// Group a flat annotation list into one section per book, preserving the
// server's order (already sorted by book title, then annotation id).
function groupByBook(annotations) {
  const groups = [];
  const byBook = new Map();
  for (const a of annotations) {
    let group = byBook.get(a.bookId);
    if (!group) {
      group = { bookId: a.bookId, title: a.title, author: a.author, items: [] };
      byBook.set(a.bookId, group);
      groups.push(group);
    }
    group.items.push(a);
  }
  return groups;
}

export default function AnnotationsPage() {
  const navigate = useNavigate();
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listAllAnnotations()
      .then(setAnnotations)
      .catch(() => setAnnotations([]))
      .finally(() => setLoading(false));
  }, []);

  // Jump to the book at this passage. The reader reads the `cfi` query param
  // and goes straight to it.
  const jumpTo = (a) => {
    const q = a.cfi ? `?cfi=${encodeURIComponent(a.cfi)}` : '';
    navigate(`/read/${a.bookId}${q}`);
  };

  const groups = groupByBook(annotations);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')} aria-label="Volver"><ArrowLeft size={22} strokeWidth={2} /></button>
        <h1 className={styles.title}>Mis subrayados</h1>
      </header>

      {loading ? (
        <p className={styles.empty}>Cargando…</p>
      ) : groups.length === 0 ? (
        <p className={styles.empty}>Aún no tienes subrayados en ningún libro.</p>
      ) : (
        <div className={styles.books}>
          {groups.map(group => (
            <section key={group.bookId} className={styles.book}>
              <header className={styles.bookHeader}>
                <h2 className={styles.bookTitle}>{group.title || 'Sin título'}</h2>
                {group.author && <p className={styles.bookAuthor}>{group.author}</p>}
              </header>
              <ul className={styles.list}>
                {group.items.map(a => {
                  const meta = [a.chapter, a.page ? `pág ${a.page}` : null].filter(Boolean).join(' · ');
                  return (
                    <li key={a.id} className={styles.item} onClick={() => jumpTo(a)}>
                      <p className={styles.snippet} style={{ borderLeftColor: a.color || '#ffd400' }}>
                        {a.text || '(sin texto)'}
                      </p>
                      {a.note && <p className={styles.note}>{a.note}</p>}
                      {meta && <p className={styles.meta}>{meta}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
