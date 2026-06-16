import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';

// Wraps the user Avatar in a button that toggles a small dropdown menu.
// The menu currently has a single item ("Salir") which calls onLogout.
// Closes on outside-click and on Escape.
export default function AvatarMenu({ user, onLogout, styles }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.avatarMenu} ref={wrapperRef}>
      <button
        type="button"
        className={styles.avatarBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de usuario"
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar user={user} className={styles.avatar} />
      </button>
      {open && (
        <div className={styles.avatarMenuPanel} role="menu">
          <button
            type="button"
            className={styles.avatarMenuItem}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Salir
          </button>
        </div>
      )}
    </div>
  );
}
