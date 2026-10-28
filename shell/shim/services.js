// Services mínimo: prefs y obs. El resto se añade según lo vayan pidiendo los módulos de Zen.

import { crearPrefs } from "./prefs.js";

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

export function crearServices(defaults = {}) {
  return {
    prefs: crearPrefs(defaults),
    obs: new ServicioObservadores(),
  };
}
