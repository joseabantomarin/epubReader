import { useState } from 'react';
import styles from './library.module.css';

// avg: número|null, count: entero, myStars: 1..5|null
// interactive: si true, permite votar (onRate(stars)) y quitar voto (onClear)
export default function StarRating({ avg, count, myStars, interactive, onRate, onClear }) {
  const [hover, setHover] = useState(0);
  const filledTo = interactive
    ? (hover || myStars || 0)
    : Math.round(avg || 0);

  const stars = [1, 2, 3, 4, 5].map((n) => {
    const on = n <= filledTo;
    if (!interactive) {
      return <span key={n} className={on ? styles.starOn : styles.starOff}>★</span>;
    }
    return (
      <button
        key={n}
        type="button"
        className={`${styles.starBtn} ${on ? styles.starOn : styles.starOff}`}
        onMouseEnter={() => setHover(n)}
        onMouseLeave={() => setHover(0)}
        onClick={(e) => {
          e.stopPropagation();
          if (myStars === n && onClear) onClear();
          else onRate?.(n);
        }}
        aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
      >★</button>
    );
  });

  return (
    <div className={styles.rating} title={interactive ? 'Tu puntuación' : 'Puntuación promedio'}>
      <span className={styles.stars}>{stars}</span>
      <span className={styles.ratingMeta}>
        {avg != null ? `${avg.toFixed(1)} (${count})` : 'Sin votos'}
      </span>
    </div>
  );
}
