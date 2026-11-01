// Lo que Rustron decide distinto de las constantes de compilación de Firefox (ver modulos/AppConstants.sys.mjs).
export function crearAppConstants(firefox, ubicacion) {
  return Object.freeze({
    ...firefox,
    // Sin servicio de shell (navegador predeterminado, fondo de escritorio), recogida de datos ni telemetría.
    HAVE_SHELL_SERVICE: false,
    MOZ_DATA_REPORTING: false,
    MOZ_TELEMETRY_REPORTING: false,
    // Varios comandos comparan `window.location.href` con esto para saber si están en la ventana del navegador.
    get BROWSER_CHROME_URL() {
      return ubicacion.href;
    },
  });
}
