// Los comandos de la ventana (`<commandset id="mainCommandSet">`) que en Firefox atiende browser-sets.js
// llamando a BrowserCommands, que a su vez usa medio navegador. Aquí cada comando es una acción sobre
// `gBrowser` (que habla con Rust) o una orden a la ventana (`enviar`). Lo que Rust aún no tiene no se
// simula: un comando sin implementar se avisa en la consola y no hace nada.

export function crearComandos(ventana, enviar) {
  const gb = () => ventana.gBrowser;
  // Los marcadores de interfaz (la pestaña vacía de Zen) no son pestañas de Rust.
  const activa = () => (gb().selectedTab?.rustronId != null ? gb().selectedTab : null);
  const enfocarBarra = () => {
    const barra = ventana.gURLBar;
    barra?.focus();
    barra?.select();
  };
  const vista = (orden) => () => enviar({ tipo: "vista", orden });

  return {
    cmd_newNavigatorTab: () => {
      // Zen decide cómo se abre una pestaña nueva (su barra flotante); si no lo gestiona, una en blanco.
      if (!ventana.gZenUIManager?.handleNewTab?.(false, false, "tab")) {
        gb().addTab("about:blank");
      }
    },
    cmd_newNavigatorTabNoEvent: () => ventana.document.getElementById("cmd_newNavigatorTab")?.doCommand(),
    cmd_close: () => activa() && gb().removeTab(activa()),
    cmd_closeWindow: vista("salir"),
    cmd_quitApplication: vista("salir"),
    "Browser:Back": () => activa() && gb().goBack(),
    "Browser:BackOrBackDuplicate": () => activa() && gb().goBack(),
    "Browser:Forward": () => activa() && gb().goForward(),
    "Browser:ForwardOrForwardDuplicate": () => activa() && gb().goForward(),
    "Browser:Reload": () => activa() && gb().reload(),
    "Browser:ReloadOrDuplicate": () => activa() && gb().reload(),
    "Browser:ReloadSkipCache": () => activa() && gb().reload({ forzar: true }),
    "Browser:Stop": vista("detener"),
    "Browser:NextTab": () => gb().tabContainer.advanceSelectedTab(1, true),
    "Browser:PrevTab": () => gb().tabContainer.advanceSelectedTab(-1, true),
    "Browser:OpenLocation": enfocarBarra,
    "Tools:Search": enfocarBarra,
    "View:FullScreen": vista("pantalla-completa"),
    cmd_fullZoomEnlarge: vista("zoom-mas"),
    cmd_fullZoomReduce: vista("zoom-menos"),
    cmd_fullZoomReset: vista("zoom-reset"),
  };
}

// Atiende los `command` del conjunto principal de comandos.
export function instalarComandos(ventana, enviar) {
  const comandos = crearComandos(ventana, enviar);
  ventana.document.getElementById("mainCommandSet")?.addEventListener("command", (evento) => {
    const id = evento.target.id;
    if (id in comandos) {
      try {
        comandos[id](evento);
      } catch (error) {
        console.error(`comando ${id}:`, error);
      }
    } else {
      console.warn(`comando sin implementar: ${id}`);
    }
  });
  return comandos;
}
