import { useEffect, useState } from 'react';

// Loads the user's avatar via fetch + blob URL. In Capacitor the webview
// can't load https://lh3.googleusercontent.com directly from an <img src>,
// but fetch is routed through CapacitorHttp and works. Falls back to the
// user's initial inside a colored circle if the picture is missing or fails.
export default function Avatar({ user, className }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!user?.picture) { setSrc(null); return; }
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      try {
        const res = await fetch(user.picture);
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setSrc(createdUrl);
      } catch { /* silent */ }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [user?.picture]);

  if (src) return <img src={src} alt="" className={className} />;
  const initial = (user?.name || user?.email || '?').trim()[0]?.toUpperCase() || '?';
  return <span className={className} aria-hidden>{initial}</span>;
}
