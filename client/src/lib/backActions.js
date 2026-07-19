// Registro mínimo de handlers para el botón/gesto atrás nativo (Android).
// Una pantalla registra un handler que devuelve true si consumió el evento;
// useNativeBack los consulta antes de aplicar su comportamiento por defecto.
const handlers = new Set();

export function registerBackHandler(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

export function tryBackHandlers() {
  for (const fn of handlers) {
    try { if (fn()) return true; } catch { /* un handler roto no debe bloquear el atrás */ }
  }
  return false;
}
