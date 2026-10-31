// Sustituye al servicio de búsqueda de Firefox (motores, configuración remota, sugerencias).
// Rustron tiene un único buscador, el de la configuración (`general.search_engine`, p. ej.
// "https://duckduckgo.com/?q=%s"). `usarBuscador` lo cambia al arrancar con el valor de Rust.

import { nuevaURI } from "../uri.js";

class Motor {
  constructor(nombre, plantilla) {
    this.name = nombre;
    this.id = nombre.toLowerCase();
    this.plantilla = plantilla;
    this.aliases = [];
    this.isConfigEngine = true;
    this.hidden = false;
    this.iconURL = null;
    this.searchUrlQueryParamName = "q";
  }

  get searchForm() {
    return new URL(this.plantilla.replace("%s", "")).origin + "/";
  }

  getSubmission(terminos) {
    return { uri: nuevaURI(this.plantilla.replace("%s", encodeURIComponent(terminos))), postData: null };
  }

  async getIconURL() {
    return null;
  }

  supportsResponseType() {
    return false;
  }
}

let motor = new Motor("DuckDuckGo", "https://duckduckgo.com/?q=%s");

export function usarBuscador(nombre, plantilla) {
  motor = new Motor(nombre, plantilla);
}

export const SearchService = {
  get isInitialized() {
    return true;
  },
  get hasSuccessfullyInitialized() {
    return true;
  },
  init: async () => {},
  get defaultEngine() {
    return motor;
  },
  get defaultPrivateEngine() {
    return motor;
  },
  getDefault: async () => motor,
  getDefaultPrivate: async () => motor,
  get visibleEngines() {
    return [motor];
  },
  getVisibleEngines: async () => [motor],
  getEngines: async () => [motor],
  getEngineByName: (nombre) => (nombre === motor.name ? motor : null),
  getEngineById: (id) => (id === motor.id ? motor : null),
  getEngineByAlias: async () => null,
  separatePrivateDefaultUrlbarResultEnabled: false,
  shouldShowInstallPrompt: false,

  // Si la URL es una búsqueda del motor, devuelve los términos; si no, un resultado vacío.
  parseSubmissionURL(url) {
    try {
      const entrada = new URL(url);
      const plantilla = new URL(motor.plantilla.replace("%s", ""));
      const parametro = plantilla.searchParams.keys().next().value ?? "q";
      if (entrada.origin === plantilla.origin && entrada.pathname === plantilla.pathname && entrada.searchParams.has(parametro)) {
        return { engine: motor, terms: entrada.searchParams.get(parametro), termsParameterName: parametro };
      }
    } catch {
      // URL inválida: no es una búsqueda
    }
    return { engine: null, terms: "", termsParameterName: "" };
  },
};
