// Sustituye a SessionStore de Firefox (restauración de sesión, tan grande como el Tabbrowser).
// Solo lo mínimo para que el arranque de Zen avance: Rustron no restaura sesiones todavía.
// Lo demás (getTabState, setTabState, undoCloseById...) no existe a propósito: fallará a la
// vista cuando Zen lo pida, y eso marca lo que habrá que implementar sobre Rust.

export const SessionStore = {
  promiseInitialized: Promise.resolve(),
  promiseAllWindowsRestored: Promise.resolve(),
};
