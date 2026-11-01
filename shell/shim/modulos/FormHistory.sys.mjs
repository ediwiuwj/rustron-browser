// Sustituye a FormHistory (el historial de campos de formulario y de búsquedas escritas, sobre SQLite). Rustron no
// guarda aún lo que se escribe en los formularios ni en la barra: no recuerda nada y buscar no devuelve nada.
// `update` y `search` avisan de que terminaron, como hace el módulo real con sus manejadores.
function terminar(manejadores) {
  manejadores?.handleCompletion?.(0);
}

export const FormHistory = {
  update: async (_cambios, manejadores) => terminar(manejadores),
  search: async (_campos, _criterios, manejadores) => {
    terminar(manejadores);
    return [];
  },
  count: async () => 0,
  getAutoCompleteResults: async () => [],
};
