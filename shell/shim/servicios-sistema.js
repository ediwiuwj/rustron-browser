// Servicios de sistema de Services que usa Zen: scriptSecurityManager, uuid, prompt,
// appinfo, wm, startup, dirsvc, focus. Lo que depende del escritorio (diálogos, ventanas,
// carpetas) se inyecta desde Rust a través del puente; los valores por defecto son seguros.

import { nuevaURI } from "./uri.js";

const ESQUEMAS_PRIVILEGIADOS = ["chrome", "resource", "file", "javascript"];

// nsIPrincipal: de quién es el código (su origen). Aquí solo los datos y las comparaciones que Firefox hace.
const ATRIBUTOS_DE_ORIGEN = Object.freeze({ userContextId: 0, privateBrowsingId: 0, firstPartyDomain: "", partitionKey: "" });

function principal(origen, campos) {
  const p = {
    isSystemPrincipal: false,
    isContentPrincipal: false,
    isNullPrincipal: false,
    isExpandedPrincipal: false,
    originNoSuffix: origen,
    origin: origen,
    originSuffix: "",
    originAttributes: ATRIBUTOS_DE_ORIGEN,
    equals: (otro) => otro?.originNoSuffix === origen,
    equalsConsideringDomain: (otro) => otro?.originNoSuffix === origen,
    ...campos,
  };
  return p;
}

export function crearScriptSecurityManager() {
  const sistema = principal("[System Principal]", { isSystemPrincipal: true });
  return {
    getSystemPrincipal: () => sistema,

    createContentPrincipal(uri) {
      return principal(uri.prePath, {
        isContentPrincipal: true,
        URI: uri,
        spec: uri.spec,
        // El mismo origen (esquema, host y puerto) que una dirección dada.
        equalsURI: (otra) => otra.prePath === uri.prePath,
        schemeIs: (esquema) => uri.scheme === esquema,
      });
    },

    createNullPrincipal: () => principal(`moz-nullprincipal:{${crypto.randomUUID()}}`, { isNullPrincipal: true }),

    // El principal del sistema carga cualquier cosa; los demás no pueden alcanzar
    // esquemas privilegiados.
    checkLoadURIStrWithPrincipal(principal, texto) {
      if (principal.isSystemPrincipal) {
        return;
      }
      const uri = nuevaURI(texto);
      if (ESQUEMAS_PRIVILEGIADOS.includes(uri.scheme)) {
        throw Object.assign(new Error(`NS_ERROR_DOM_BAD_URI: ${uri.scheme}: bloqueado`), {
          result: "NS_ERROR_DOM_BAD_URI",
        });
      }
    },
  };
}

class UUID {
  #valor;

  constructor(valor) {
    this.#valor = valor;
  }

  // Firefox devuelve el UUID entre llaves; Zen las quita con slice(1, -1).
  toString() {
    return `{${this.#valor}}`;
  }
}

export function crearUUID() {
  return { generateUUID: () => new UUID(crypto.randomUUID()) };
}

// Botones de nsIPromptService: cada posición codifica el título estándar del botón.
const BUTTON_POS_0 = 1;
const BUTTON_POS_1 = 256;
const BUTTON_TITLE_YES = 3;
const BUTTON_TITLE_NO = 4;

// dialogos: { confirmar(titulo, texto) -> bool, pedir(titulo, texto, valorInicial) -> string|null }.
// Sin dialogos reales se rechaza todo, que es lo menos peligroso (nada se borra por error).
export function crearPrompt(dialogos = {}) {
  const confirmar = dialogos.confirmar ?? (() => false);
  const pedir = dialogos.pedir ?? (() => null);
  return {
    BUTTON_POS_0,
    BUTTON_POS_1,
    BUTTON_TITLE_YES,
    BUTTON_TITLE_NO,
    STD_YES_NO_BUTTONS: BUTTON_TITLE_YES * BUTTON_POS_0 + BUTTON_TITLE_NO * BUTTON_POS_1,
    MODAL_TYPE_WINDOW: 3,

    confirm: (_ventana, titulo, texto) => confirmar(titulo, texto),

    // `valor` es un objeto { value } que se lee y se escribe, como el parámetro in/out XPCOM.
    prompt(_ventana, titulo, texto, valor) {
      const respuesta = pedir(titulo, texto, valor?.value ?? "");
      if (respuesta === null || respuesta === undefined) {
        return false;
      }
      valor.value = respuesta;
      return true;
    },

    // Resuelve con un "property bag"; el botón 0 es el primero (Sí en STD_YES_NO_BUTTONS).
    async asyncConfirmEx(_contexto, _tipo, titulo, texto) {
      const respuesta = await confirmar(titulo, texto);
      return new Map([["buttonNumClicked", respuesta ? 0 : 1]]);
    },
  };
}

export function crearAppInfo(info = {}) {
  return {
    version: "1.23.4",
    platformBuildID: "20260101000000",
    OS: "Linux",
    inSafeMode: false,
    ...info,
  };
}

export function crearStartup() {
  const inicio = new Date();
  return { shuttingDown: false, getStartupInfo: () => ({ start: inicio }) };
}

// carpetas: { ProfD: "/ruta", LocalAppData: "/ruta", ... }
export function crearDirsvc(carpetas = {}) {
  return {
    get(nombre) {
      if (!(nombre in carpetas)) {
        throw Object.assign(new Error(`NS_ERROR_FAILURE: carpeta desconocida ${nombre}`), {
          result: "NS_ERROR_FAILURE",
        });
      }
      return { path: carpetas[nombre] };
    },
  };
}

// Por ahora una sola ventana de navegador. `ventana` es la ventana de la interfaz.
export function crearWindowMediator(ventana) {
  const navegador = "navigator:browser";
  const lista = () => (ventana ? [ventana] : []);
  return {
    getMostRecentWindow: (tipo) => (tipo === navegador ? (ventana ?? null) : null),
    getMostRecentBrowserWindow: () => ventana ?? null,
    getEnumerator: (tipo) => (tipo === navegador || tipo === null ? lista() : []),
  };
}

export function crearFocus(ventana) {
  return { activeWindow: ventana ?? null };
}

// formatURLPref: lee la preferencia y sustituye las variables de Firefox que no tengan sentido aquí.
export function crearUrlFormatter(prefs) {
  return {
    formatURL: (texto) => texto,
    formatURLPref: (nombre) => prefs.getStringPref(nombre, ""),
  };
}
