// Cupo diario de consultas de IA para visitantes anónimos, en memoria por IP.
// Se reinicia con el proceso: es un empujón a autenticarse, no facturación.
export const ANON_AI_LIMIT = 10;

let day = null;
const counts = new Map();

export function consumeAnonQuota(ip, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (today !== day) { day = today; counts.clear(); }
  const used = counts.get(ip) ?? 0;
  if (used >= ANON_AI_LIMIT) return false;
  counts.set(ip, used + 1);
  return true;
}
