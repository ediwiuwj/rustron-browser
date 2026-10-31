// Services: lo que los módulos de Zen piden al arrancar, añadido según lo vayan pidiendo.

import { crearPrefs } from "./prefs.js";
import { nuevaURI } from "./uri.js";
import {
  crearAppInfo,
  crearDirsvc,
  crearFocus,
  crearPrompt,
  crearScriptSecurityManager,
  crearUrlFormatter,
  crearStartup,
  crearUUID,
  crearWindowMediator,
} from "./servicios-sistema.js";

class ServicioObservadores {
  #porTema = new Map();

  addObserver(observador, tema) {
    if (!this.#porTema.has(tema)) {
      this.#porTema.set(tema, new Set());
    }
    this.#porTema.get(tema).add(observador);
  }

  removeObserver(observador, tema) {
    this.#porTema.get(tema)?.delete(observador);
  }

  notifyObservers(sujeto, tema, datos) {
    for (const observador of [...(this.#porTema.get(tema) ?? [])]) {
      if (typeof observador === "function") {
        observador(sujeto, tema, datos);
      } else {
        observador.observe(sujeto, tema, datos);
      }
    }
  }
}

// opciones: { dialogos, appinfo, carpetas, ventana } los pone el puente con Rust (M2).
export function crearServices(defaults = {}, opciones = {}) {
  const prefs = crearPrefs(defaults);
  return {
    prefs,
    urlFormatter: crearUrlFormatter(prefs),
    obs: new ServicioObservadores(),
    io: { newURI: nuevaURI },
    scriptSecurityManager: crearScriptSecurityManager(),
    uuid: crearUUID(),
    prompt: crearPrompt(opciones.dialogos),
    appinfo: crearAppInfo(opciones.appinfo),
    startup: crearStartup(),
    dirsvc: crearDirsvc(opciones.carpetas),
    wm: crearWindowMediator(opciones.ventana),
    focus: crearFocus(opciones.ventana),
  };
}
