// Puente entre los espacios de Rust y los "workspaces" de Zen. En Firefox los restaura el gestor de
// sesión (ZenSessionManager) llamando a gZenWorkspaces.restoreWorkspacesFromSessionStore; aquí los
// da Rust, que es quien manda: un espacio de Rust = un workspace de Zen.

// Zen usa UUIDs entre llaves como identificador de espacio (y como atributo `zen-workspace-id`).
// El UUID se deriva del id de Rust, así que es estable entre ventanas y arranques.
export const uuidDeEspacio = (id) => `{00000000-0000-4000-8000-${String(id).padStart(12, "0")}}`;

export function datosDeEspacio(ventana, espacio) {
  return {
    uuid: uuidDeEspacio(espacio.id),
    name: espacio.nombre,
    icon: undefined,
    theme: ventana.nsZenThemePicker?.getTheme?.([]),
    containerTabId: 0,
  };
}

// Entrega a Zen los espacios del puente y avisa de que la ventana está restaurada.
export function restaurarEspacios(ventana, puente) {
  const zen = ventana.gZenWorkspaces;
  zen.restoreWorkspacesFromSessionStore({
    spaces: puente.espacios.map((e) => datosDeEspacio(ventana, e)),
    activeZenSpace: puente.espacioActivo == null ? undefined : uuidDeEspacio(puente.espacioActivo),
  });
  return zen.onWindowRestored();
}
