// AppConstants: constantes de compilación de Firefox que consulta Zen.

export const AppConstants = Object.freeze({
  platform: "linux",
  // Rustron no tiene servicio de shell (navegador predeterminado, fondo de escritorio).
  HAVE_SHELL_SERVICE: false,
  MOZ_MOZILLA_API_KEY: "no-mozilla-api-key",
  // Como una compilación de lanzamiento: sin los ayudantes de desarrollo ni la recogida de datos.
  MOZILLA_OFFICIAL: true,
  MOZ_DATA_REPORTING: false,
  MOZ_TELEMETRY_REPORTING: false,
});
