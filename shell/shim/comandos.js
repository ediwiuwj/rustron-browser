// Los comandos de la ventana (`<commandset id="mainCommandSet">`) los atiende el browser-sets.js real de Firefox
// (se carga con los scripts globales), que llama a BrowserCommands y a gBrowser. Aquí solo van los que dependen
// de la ventana del anfitrión, que es de Rust y no la ve el navegador web: salir, pantalla completa, detener la
// carga y el zoom de la página. Se atienden en la fase de captura y se corta el evento, para que el código real
// de Firefox no los ejecute también.

export function crearComandos(enviar) {
  const orden = (nombre) => () => enviar({ tipo: "vista", orden: nombre });
  return {
    cmd_closeWindow: orden("salir"),
    cmd_quitApplication: orden("salir"),
    "Browser:Stop": orden("detener"),
    "View:FullScreen": orden("pantalla-completa"),
    cmd_fullZoomEnlarge: orden("zoom-mas"),
    cmd_fullZoomReduce: orden("zoom-menos"),
    cmd_fullZoomReset: orden("zoom-reset"),
  };
}

export function instalarComandos(ventana, enviar) {
  const comandos = crearComandos(enviar);
  ventana.document.addEventListener(
    "command",
    (evento) => {
      const id = evento.target.id;
      if (id in comandos) {
        evento.stopPropagation();
        try {
          comandos[id](evento);
        } catch (error) {
          console.error(`comando ${id}:`, error);
        }
      }
    },
    true
  );
  return comandos;
}
