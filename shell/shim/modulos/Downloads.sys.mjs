// Sustituye a Downloads (lista de descargas de Firefox). Rustron aún no gestiona descargas: la lista está
// siempre vacía y no avisa de nada. Crear o reanudar descargas (Downloads.createDownload...) no existe.

const lista = {
  addView: async () => {},
  removeView: async () => {},
  getAll: async () => [],
};

export const Downloads = {
  PUBLIC: 1,
  PRIVATE: 2,
  ALL: 3,
  getList: async () => lista,
  getSummary: async () => ({ addView: async () => {}, removeView: async () => {} }),
};
