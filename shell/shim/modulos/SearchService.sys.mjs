// Sustituye al servicio de búsqueda de Firefox (motores, configuración remota, sugerencias).
// Rustron tiene un único buscador, el de la configuración (`general.search_engine`, p. ej.
// "https://duckduckgo.com/?q=%s"). `usarBuscador` lo cambia al arrancar con el valor de Rust.

import { nuevaURI } from "../uri.js";
import { crearETLD } from "../servicios-navegador.js";

const eTLD = crearETLD();

class Motor {
  constructor(nombre, plantilla) {
    this.name = nombre;
    this.id = nombre.toLowerCase();
    this.plantilla = plantilla;
    this.aliases = [];
    this.isGeneralPurposeEngine = true; // un buscador web normal, no uno de un sitio concreto
    this.hideOneOffButton = false;
    this.isNewUntil = "";
    this.isConfigEngine = true;
    this.hidden = false;
    this.iconURL = null;
    this.searchUrlQueryParamName = "q";
  }

  // El dominio de la dirección de búsqueda (la barra lo compara con lo que se escribe para ofrecer «Buscar con X»).
  get searchUrlDomain() {
    return new URL(this.plantilla.replace("%s", "")).hostname;
  }

  get searchUrlPublicSuffix() {
    return eTLD.getKnownPublicSuffixFromHost(this.searchUrlDomain);
  }

  // Un identificador de telemetría que Rustron no envía: el nombre basta para distinguir los motores.
  get telemetryId() {
    return this.id;
  }

  // Datos que Firefox pide a todo motor para su telemetría de búsquedas: sin código de socio ni reemplazo de terceros.
  partnerCode = "";
  overriddenById = null;

  // La dirección del motor de un tipo: `text/html` es la página de resultados (la que se abre al buscar).
  getURLOfType(tipo) {
    if (tipo !== "text/html") {
      return null;
    }
    return {
      type: tipo,
      method: "GET",
      template: this.plantilla,
      params: [],
      resultDomain: this.searchUrlDomain,
      excludePartnerCodeFromTelemetry: false,
      getSubmission: (terminos) => this.getSubmission(terminos),
    };
  }

  // Si el usuario ya buscó con este motor (la barra lo usa para decidir qué sugerir). Rust aún no lo recuerda.
  hasBeenUsed = false;
  markAsUsed() {
    this.hasBeenUsed = true;
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

  isNew() {
    return false;
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
  findContextualSearchEngineByHost: async () => null,
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
