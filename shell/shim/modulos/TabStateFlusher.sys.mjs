// Sustituye a TabStateFlusher de Firefox (vacía el estado de sesión de una pestaña antes de guardarlo).
// Rustron no restaura sesiones de Firefox, así que no hay estado pendiente que vaciar.

export const TabStateFlusher = {
  flush: async () => {},
  flushWindow: async () => {},
};
