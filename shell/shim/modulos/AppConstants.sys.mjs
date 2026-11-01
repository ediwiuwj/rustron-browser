// AppConstants: las constantes de compilación del propio Firefox (las reales, del omni.ja de Zen) con lo que Rustron
// decide distinto (ver app-constants.js): sin telemetría ni servicio de shell, y la dirección de la ventana, que aquí
// es la de la interfaz y no chrome://browser/content/browser.xhtml.
import { AppConstants as Firefox } from "/gre/modules/AppConstants.sys.mjs";
import { crearAppConstants } from "../app-constants.js";

export const AppConstants = crearAppConstants(Firefox, globalThis.location);
