export function relativeTime(value, now = new Date()) {
  if (!value) return 'nunca';
  const then = new Date(value);
  const diff = Math.max(0, now.getTime() - then.getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'ahora';
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

export function percent(n) {
  return `${Math.round((n || 0) * 100)}%`;
}
