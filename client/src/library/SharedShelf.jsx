import { useState } from 'react';
import styles from './library.module.css';
import BookCard from './BookCard.jsx';
import StarRating from './StarRating.jsx';
import { api } from '../lib/api.js';

// books: lista de /api/shared (ya filtrada de "mine"). canRate: hay sesión.
export default function SharedShelf({ books, canRate, onOpen }) {
  const [ratings, setRatings] = useState({}); // id -> { avgStars, ratingCount, myStars }

  const merged = (b) => ({ ...b, ...(ratings[b.id] || {}) });

  const rate = async (id, stars) => {
    try { setRatings((r) => ({ ...r, [id]: await api.rateShared(id, stars) })); }
    catch (e) { console.error('[rate]', e); }
  };
  const clear = async (id) => {
    try { setRatings((r) => ({ ...r, [id]: await api.unrateShared(id) })); }
    catch (e) { console.error('[unrate]', e); }
  };

  if (books.length === 0) {
    return <p className={styles.empty}>Aún no hay libros compartidos.</p>;
  }

  return (
    <div className={styles.grid}>
      {books.map((raw) => {
        const b = merged(raw);
        return (
          <div key={b.id} className={styles.sharedItem}>
            <BookCard book={b} shared onActivate={() => onOpen(b)} />
            <p className={styles.sharedBy}>compartido por {b.sharedBy}</p>
            <StarRating
              avg={b.avgStars}
              count={b.ratingCount}
              myStars={b.myStars}
              interactive={canRate}
              onRate={(s) => rate(b.id, s)}
              onClear={() => clear(b.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
