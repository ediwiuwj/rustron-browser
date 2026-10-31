// ZenWorkspaceBookmarksStorage guarda en la base de lugares qué marcadores pertenecen a cada espacio.
// Rustron aún no tiene marcadores ni base de datos de lugares, así que la asociación está vacía:
// "ningún marcador asignado a ningún espacio". Se sustituyen las lecturas (con la misma forma de
// resultado que las consultas SQL de Zen); las escrituras no existen a propósito y fallarán a la
// vista cuando haya marcadores que asignar.

export function usarMarcadoresVacios(ventana) {
  Object.assign(ventana.ZenWorkspaceBookmarksStorage, {
    promiseInitialized: Promise.resolve(),
    getLastChangeTimestamp: async () => 0,
    getBookmarkWorkspaces: async () => [],
    getBookmarkGuidsByWorkspace: async () => ({}),
    getChangedIDs: async () => ({}),
    clearChangedIDs: async () => {},
  });
}
