// Arranque de la ventana de Zen: define los globales de Firefox, instala el emulador XUL y
// ejecuta el JS real de Zen. No se detiene en el primer fallo: anota todos los errores en
// window.__arranque para ver qué falta. Lo sirve scripts/servir-zen.py.

import { crearServices } from "./services.js";
import { RegistroModulos, crearChromeUtils, funcionesQI } from "./chrome-utils.js";
import { instalarXUL } from "./xul.js";
import { instalarL10n, elegirLocales } from "./l10n.js";
import { crearXPCOMUtils } from "./xpcom-utils.js";
import { crearPathUtils, crearIOUtils, almacenEnMemoria } from "./archivos.js";
import { usarAlmacenamiento } from "./modulos/JSONFile.sys.mjs";

const almacenArchivos = almacenEnMemoria();
import { instalarComplementosXUL } from "./elementos-firefox.js";
import { Puente, instalarEnVentana } from "./puente.js";
import { GBrowser } from "./gbrowser.js";
import { restaurarEspacios, uuidDeEspacio } from "./sesion-zen.js";
import { usarMarcadoresVacios } from "./marcadores-zen.js";
import { definirArrowScrollbox } from "./arrowscrollbox.js";

const LIMITE_MODULOS = 400;

const estado = (window.__arranque = { errores: [], modulos: { ok: [], fallo: [] }, pasos: [], hecho: false });

function anotar(origen, error) {
  estado.errores.push({
    origen,
    mensaje: String(error?.message ?? error),
    pila: [error?.donde, ...String(error?.stack ?? "").split("\n").slice(0, 3)].filter(Boolean).join(" | "),
  });
}

// Zen captura muchos fallos con console.error y sigue: se anotan también.
const consolaError = console.error.bind(console);
console.error = (...argumentos) => {
  anotar("console.error", argumentos.map((a) => (a?.message ? `${a.name ?? "Error"}: ${a.message}\n${a.stack ?? ""}` : String(a))).join(" "));
  consolaError(...argumentos);
};

window.addEventListener("error", (e) => anotar("error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => anotar("promesa", e.reason));

const mapas = Object.entries(
  JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports
);
const registro = new RegistroModulos(mapas);

// crudo: el texto original, sin que el servidor reescriba los imports (para leer sus especificadores).
function leerSync(url, crudo = false) {
  const peticion = new XMLHttpRequest();
  peticion.open("GET", registro.resolver(url) + (crudo ? "?crudo" : ""), false);
  peticion.send();
  if (peticion.status !== 200) {
    throw new Error(`HTTP ${peticion.status}: ${url}`);
  }
  return peticion.responseText;
}

// Lo que un script de Firefox espera encontrar como globales.
// Scripts de toolkit que se omiten porque dependen de attachShadow, que WebKit no admite en elementos
// XUL. Cada uno tiene un sustituto propio (arrowscrollbox) o conserva la emulación de xul.js (popups).
const OMITIDOS = [
  "arrowscrollbox", "dialog", "menupopup", "panel", "autocomplete-popup", "tree", "wizard", "menulist",
  "autocomplete-richlistitem", // depende del autocompletado de contraseñas (LoginHelper)
].map((n) => `chrome://global/content/elements/${n}.js`);

let profundidad = 0;

// Un <script> clásico comparte el ámbito léxico global (let, const y class de nivel superior los ven los
// scripts siguientes), como los de loadSubScript en Firefox; `eval` indirecto daba a cada script el suyo.
// Los errores de un <script> no llegan a quien lo inserta: se recogen del evento `error`, que se asigna
// al script más interno en ejecución (los scripts pueden cargar a otros).
const scriptsEnCurso = [];

window.addEventListener(
  "error",
  (e) => {
    const actual = scriptsEnCurso.at(-1);
    if (actual) {
      actual.fallo = e.error ?? new Error(e.message);
      actual.fallo.donde = `${actual.url}:${e.lineno}:${e.colno}`;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true
);

function ejecutarComoScript(codigo, url) {
  const registro = { url, fallo: null };
  const guion = document.createElementNS("http://www.w3.org/1999/xhtml", "script");
  guion.textContent = codigo;
  scriptsEnCurso.push(registro);
  try {
    document.documentElement.append(guion);
  } finally {
    scriptsEnCurso.pop();
    guion.remove();
  }
  if (registro.fallo) {
    throw registro.fallo;
  }
}

// Como en Firefox, con destino `window` el código se evalúa como script global: `var` y `function`
// de nivel superior pasan a ser globales de la ventana. Un script anidado (los que carga otro) que
// falla se anota y no interrumpe a quien lo cargó.
function loadSubScript(url, destino) {
  if (OMITIDOS.includes(url)) {
    (estado.omitidos ??= []).push(url);
    return;
  }
  const codigo = `${leerSync(url)}\n//# sourceURL=${url}`;
  profundidad++;
  try {
    if (destino === window) {
      ejecutarComoScript(codigo, url);
    } else {
      new Function(codigo).call(destino ?? window);
    }
  } catch (error) {
    if (profundidad === 1) {
      throw error;
    }
    anotar(`loadSubScript ${url}`, error);
  } finally {
    profundidad--;
  }
}

function definirGlobales(defaults) {
  const Services = crearServices(defaults, { ventana: window });
  Services.scriptloader = { loadSubScript };
  window.Services = Services;
  window.XPCOMUtils = crearXPCOMUtils(Services); // en la ventana de Firefox es un global
  // Constantes de nsIWebBrowserChrome (valores propios, solo importa que sean distintos).
  const constantes = { nsIWebBrowserChrome: { CHROME_TOOLBAR: 4, CHROME_MENUBAR: 8 } };
  // Cada interfaz es una función (el código de Firefox hace `x instanceof Ci.nsIFoo`) con sus constantes.
  const interfaces = new Map();
  window.Ci = new Proxy({}, {
    get(_, nombre) {
      if (typeof nombre !== "string") {
        return undefined;
      }
      if (!interfaces.has(nombre)) {
        const interfaz = function () {};
        Object.defineProperty(interfaz, Symbol.hasInstance, { value: () => false }); // nada implementa interfaces XPCOM aquí
        interfaces.set(nombre, Object.assign(interfaz, constantes[nombre], { nombre }));
      }
      return interfaces.get(nombre);
    },
  });
  // Una ventana de navegador normal (con barras), no un popup.
  const propietario = {
    QueryInterface: () => propietario,
    getInterface: () => ({
      chromeFlags: 4 | 8,
      // Cierra los popups abiertos (Zen lo pide al recolocar la barra lateral).
      rollupAllPopups() {
        document.querySelectorAll('[state="open"]').forEach((p) => p.hidePopup?.());
      },
    }),
  };
  // Sin procesos de contenido separados: Rustron lleva WebKit, no Gecko multiproceso.
  const docShell = { treeOwner: propietario, useRemoteTabs: false, useRemoteSubframes: false, QueryInterface: () => docShell };
  window.docShell = docShell;
  window.Cr = new Proxy({}, { get: (_, nombre) => (typeof nombre === "string" ? nombre : undefined) });
  window.Cu = {
    getWeakReference: (objeto) => ({ get: () => objeto }),
    isESModuleLoaded: (url) => registro.estaCargado(url),
  };
  window.Cc = new Proxy(
    {},
    {
      get: (_, contrato) => {
        if (contrato === "@mozilla.org/xre/app-info;1") {
          return { getService: () => Services.appinfo };
        }
        const falla = () => {
          throw new Error(`NS_ERROR_NOT_AVAILABLE: componente XPCOM sin emular ${String(contrato)}`);
        };
        return { getService: falla, createInstance: falla };
      },
    }
  );
  window.Components = {
    interfaces: Ci,
    classes: Cc,
    results: Cr,
    utils: Cu,
    Exception: Error,
    // Como Cc: declarar el constructor no falla, usarlo sí (el componente XPCOM no está emulado).
    Constructor: (contrato) =>
      function () {
        throw new Error(`NS_ERROR_NOT_AVAILABLE: componente XPCOM sin emular ${contrato}`);
      },
  };
  window.ChromeUtils = crearChromeUtils(registro);
  // Global de la ventana de Firefox; el módulo se precarga más tarde, así que es perezoso.
  const globalesPerezosos = {
    PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
    AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
    SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
    Tabbrowser: "moz-src:///browser/components/tabbrowser/Tabbrowser.sys.mjs",
    PanelMultiView: "moz-src:///browser/components/customizableui/PanelMultiView.sys.mjs",
    CustomizableUI: "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
    Downloads: "resource://gre/modules/Downloads.sys.mjs",
  };
  for (const [nombre, url] of Object.entries(globalesPerezosos)) {
    Object.defineProperty(window, nombre, { configurable: true, get: () => registro.importar(url)[nombre] });
  }
  // Elementos de la ventana que browser.js expone como globales (se resuelven al usarlos).
  for (const [nombre, id] of [["gNavToolbox", "navigator-toolbox"], ["gURLBar", "urlbar"]]) {
    Object.defineProperty(window, nombre, { configurable: true, get: () => document.getElementById(id) });
  }
  window.DynamicShortcutTooltip = { getText: (id) => TEXTOS_DE_PESTANAS[id] ?? id, nodeToTooltipMap: {}, cache: new Map() };
  // La barra de direcciones corre en el mismo proceso que su controlador: el "actor" que Firefox usaría
  // para hablar con el proceso padre es un objeto local que solo sabe de qué ventana es.
  window.windowGlobalChild = {
    getActor: () => ({
      browsingContext: { topChromeWindow: window, isContent: false, top: { embedderElement: null } },
      sendAsyncMessage() {},
    }),
  };
  // Envoltorio de devoluciones de llamada de Places (referencia débil): aquí basta con guardarla.
  window.PlacesWeakCallbackWrapper ??= class PlacesWeakCallbackWrapper {
    constructor(callback) {
      this.callback = callback;
    }
  };
  // Notificaciones de Places (historial, marcadores): sin base de lugares no hay nada que notificar.
  window.PlacesObservers ??= { addListener() {}, removeListener() {}, notifyListeners() {} };
  // Telemetría (Glean): Rustron no tiene; cualquier ruta Glean.a.b.c.metodo(...) es una llamada vacía.
  const vacio = new Proxy(function () {}, { get: () => vacio, apply: () => undefined });
  window.Glean = vacio;
  window.GleanPings = vacio;
  window.webrtcUI = { browserHasStreams: () => false }; // compartir cámara/pantalla: no existe aún
  // Localización (Fluent): los .ftl los sirve /l10n/<idioma>/<ruta> (carpetas localization/ de Zen y de la
  // base de Firefox); los idiomas son los del sistema y, al final, el inglés.
  const cargarFtl = (idioma, ruta) => {
    const peticion = new XMLHttpRequest();
    peticion.open("GET", `/l10n/${idioma}/${ruta}`, false);
    peticion.send();
    return peticion.status === 200 ? peticion.responseText : null;
  };
  instalarL10n(window, { cargar: cargarFtl, locales: elegirLocales(navigator.languages) });
  window.gClickAndHoldListenersOnElement = { add() {}, remove() {} }; // clic prolongado en botones: sin emular
  // La parte de nsIDOMWindowUtils que usa Zen para medir sin forzar layout.
  window.windowUtils = {
    getBoundsWithoutFlushing: (el) => el.getBoundingClientRect(),
    flushLayoutWithoutThrottling() {},
    get screenPixelsPerCSSPixel() {
      return window.devicePixelRatio;
    },
  };
  // Lo que Firefox ofrece a la ventana y WebKit no (APIs de la plataforma, no de Rustron):
  window.requestIdleCallback ??= (llamada, { timeout = 50 } = {}) =>
    setTimeout(() => llamada({ didTimeout: false, timeRemaining: () => 8 }), Math.min(timeout, 50));
  window.cancelIdleCallback ??= (id) => clearTimeout(id);
  // Ejecuta `f` con el layout al día (tras el siguiente fotograma) y entrega su resultado.
  window.promiseDocumentFlushed = (f) =>
    new Promise((ok, no) =>
      requestAnimationFrame(() => {
        try {
          ok(f());
        } catch (e) {
          no(e);
        }
      })
    );
  // InspectorUtils.colorToRGBA: el color calculado por el motor, que también entiende los colores del sistema.
  window.InspectorUtils = {
    colorToRGBA(color, documento = document) {
      const prueba = documento.createElementNS("http://www.w3.org/1999/xhtml", "span");
      prueba.style.color = color;
      documento.documentElement.appendChild(prueba);
      const calculado = getComputedStyle(prueba).color;
      prueba.remove();
      const m = calculado.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    },
  };
  // nsIControllers de los campos de texto: Zen/Firefox instalan ahí sus controladores de copiar y cortar.
  // WebKit gestiona copiar, cortar y pegar por su cuenta, así que no hay controladores que registrar.
  const sinControladores = { insertControllerAt() {}, appendController() {}, removeController() {}, getControllerCount: () => 0 };
  for (const Campo of [HTMLInputElement, HTMLTextAreaElement]) {
    Object.defineProperty(Campo.prototype, "controllers", { configurable: true, get: () => sinControladores });
  }
  window.HandleAppCommandEvent = () => {}; // botones atrás/adelante del ratón: aún sin emular
  window.delayedStartupPromise = Promise.resolve(); // no hay arranque diferido que esperar
  window.PathUtils = crearPathUtils();
  window.IOUtils = crearIOUtils();
  usarAlmacenamiento({ ...almacenArchivos, leerSync: () => null });
}

// Zen los pide con importESModule("...") en tiempo de ejecución; se precargan a mano.
const MODULOS_CITADOS_POR_CADENA = [
  "resource:///modules/zen/ZenSpaceManager.mjs", // crea window.gZenWorkspaces; ZenLibrary lo usa al definirse
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  "resource://gre/modules/AppConstants.sys.mjs",
  "resource://gre/modules/PlacesUtils.sys.mjs",
  "moz-src:///browser/components/tabbrowser/Tabbrowser.sys.mjs",
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  "moz-src:///browser/components/tabbrowser/TabMetrics.sys.mjs",
  "moz-src:///browser/components/aiwindow/ui/modules/AIWindow.sys.mjs",
  "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  "resource:///modules/ZenCustomizableUI.sys.mjs", // la barra lateral: CustomizableUI.iniciarVentana lo usa
  "resource://gre/modules/Downloads.sys.mjs",
  "resource:///modules/webrtcUI.sys.mjs",
  "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs",
  "moz-src:///browser/components/tabnotes/TabNotes.sys.mjs",
  "moz-src:///browser/components/sharing/ContentSharingUtils.sys.mjs",
  "moz-src:///browser/components/customizableui/PanelMultiView.sys.mjs",
  "chrome://global/content/lit-utils.mjs",
  "resource://nimbus/ExperimentAPI.sys.mjs",
  "resource:///modules/ZenUBProvider.sys.mjs",
  "resource:///modules/ZenSiteDataPanel.sys.mjs",
  "moz-src:///zen/library/ZenLibraryWidget.sys.mjs",
  ...["Boosts", "Downloads", "History", "Media", "Search", "SpaceRouting"].map(
    (nombre) => `moz-src:///zen/library/sections/ZenLibrary${nombre}Section.mjs`
  ),
  "moz-src:///browser/components/urlbar/UrlbarPrefs.sys.mjs",
  // Al final: dependen de los anteriores (nimbus, PlacesUtils, el buscador...) ya precargados.
  "chrome://browser/content/zen-components/ZenHasPolyfill.mjs", // browser.xhtml lo carga como <script type="module">
  "resource:///modules/ZenUBActionsProvider.sys.mjs",
  "resource:///modules/ZenUBSidebarProvider.sys.mjs",
];

// Los que customElements.js de toolkit carga de inmediato.
const SCRIPTS_DE_ELEMENTOS = [
  "arrowscrollbox", "dialog", "general", "button", "checkbox", "menu", "menupopup", "notificationbox",
  "panel", "popupnotification", "radio", "richlistbox", "autocomplete-popup", "autocomplete-richlistitem",
  "tabbox", "text", "toolbarbutton", "tree", "wizard",
];

const ESPECIFICADORES = /(?:chrome|resource|moz-src):\/\/[^\s"'`)]*?\.m?js\b/g;
// import/export ... from "x" e import "x" (no las llamadas import(), que son perezosas).
const IMPORTS_ESTATICOS = /(?:^|[;\s}])(?:import|export)\s[^;"']*?from\s*["']([^"']+)["']|(?:^|[;\s])import\s*["']([^"']+)["']/gm;
const esUrlDeModulo = (u) => /^(chrome|resource|moz-src):\/\//.test(u);

// Módulos de los que depende `url` por imports estáticos (los que fallen al leer se anotan aparte).
const dependencias = new Map();

function dependenciasDe(url) {
  if (!dependencias.has(url)) {
    let lista = [];
    try {
      lista = [...leerSync(url, true).matchAll(IMPORTS_ESTATICOS)].map((m) => m[1] ?? m[2]).filter(esUrlDeModulo);
    } catch (error) {
      estado.modulos.fallo.push({ url, error: String(error?.message ?? error), causa: "lectura" });
    }
    dependencias.set(url, lista);
  }
  return dependencias.get(url);
}

// Recorrido en postorden: cada módulo aparece después de sus dependencias.
function ordenar(raices) {
  const orden = [];
  const visto = new Set();
  const visitar = (url) => {
    if (visto.has(url)) {
      return;
    }
    if (visto.size >= LIMITE_MODULOS) {
      estado.errores.push({ origen: "ordenar", mensaje: `LIMITE_MODULOS (${LIMITE_MODULOS}) alcanzado: se omite ${url}` });
      return;
    }
    visto.add(url);
    dependenciasDe(url).forEach(visitar);
    orden.push(url);
  };
  raices.forEach(visitar);
  return orden;
}

const fallidos = new Set();

// Importa los módulos que cite `texto` y sus dependencias estáticas, hojas primero.
// Si uno falla, los que dependen de él se marcan como consecuencia y no se intentan.
// Evaluarlos pronto cambia el orden de Firefox: ZenLibrary instancia su elemento al definirse y
// sus secciones extienden window.ZenDragAndDrop, que Zen define al final de ZenPreloadedScripts.
const MODULOS_TARDIOS = [
  // Al definirse, <urlbar-input> se conecta y pide gZenVerticalTabsManager, que define ZenPreloadedScripts.
  "chrome://browser/content/urlbar/UrlbarInput.mjs",
  "moz-src:///zen/library/sections/ZenLibrarySpacesSection.mjs",
  "moz-src:///zen/library/ZenLibrary.mjs",
];

async function precargarDe(texto, { tardio = false } = {}) {
  let raices = [...texto.matchAll(ESPECIFICADORES)].map((m) => m[0]).filter((u) => u.endsWith(".mjs"));
  raices.unshift(...MODULOS_CITADOS_POR_CADENA);
  if (!tardio) {
    raices = raices.filter((u) => !MODULOS_TARDIOS.includes(u));
  }
  raices = raices.filter((u) => !u.endsWith("/browser-custom-element.mjs")); // <browser> real: aún no
  for (const url of ordenar(raices)) {
    const roto = dependenciasDe(url).find((d) => fallidos.has(d));
    if (roto) {
      fallidos.add(url);
      estado.modulos.fallo.push({ url, error: `depende de ${roto}`, causa: "dependencia" });
      continue;
    }
    try {
      await registro.precargar([url]);
      estado.modulos.ok.push(url);
    } catch (error) {
      fallidos.add(url);
      const deps = dependenciasDe(url).map((d) => `${d.split("/").pop()}:${estado.modulos.ok.includes(d) ? "ok" : "NO"}`);
      estado.modulos.fallo.push({ url, error: String(error?.message ?? error), causa: "propia", deps, pila: String(error?.stack ?? "").split("\n").slice(0, 6).join(" | ") });
    }
  }
}

const TEXTOS_DE_PESTANAS = { "tabbrowser-empty-tab-title": "New Tab" };

let puenteLocal = null;

// Dentro de Rustron hay un manejador de mensajes `rustron` y el puente es el real (Rust manda). Sin Rust
// (la página servida sola, para diagnóstico) el puente es local: una pestaña en blanco.
async function crearPuente() {
  if (!window.webkit?.messageHandlers?.rustron) {
    return crearPuenteLocal();
  }
  const puente = instalarEnVentana(window);
  const instantanea = new Promise((resolver) => {
    const baja = puente.on("instantanea", () => (baja(), resolver()));
  });
  puente.conectar();
  await Promise.race([
    instantanea,
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("Rust no respondió a `listo`")), 10_000)),
  ]);
  return puente;
}

function crearPuenteLocal() {
  const puente = new Puente(() => {});
  puente.recibir(JSON.stringify({
    tipo: "instantanea",
    estado: {
      espacios: [{ id: 1, nombre: "Space", pestanas: [1] }],
      pestanas: [{ id: 1, titulo: "", uri: "about:blank", cargando: false, fijada: false, espacio: 1 }],
      espacioActivo: 1, pestanaActiva: 1, barraVisible: true, compacto: false, barraUrlAbierta: false,
    },
  }));
  return puente;
}

function instalarGBrowser(puente) {
  window.gBrowser = new GBrowser(puente, {
    crearElemento: () => {
      const tab = document.createXULElement("tab", { is: "tabbrowser-tab" });
      tab.className = "tabbrowser-tab"; // como _createTab: el CSS de Zen cuelga de esta clase
      return tab;
    },
    contenedor: document.getElementById("tabbrowser-tabs") ?? document.createXULElement("tabs"),
    principal: (uri) => window.Services.scriptSecurityManager.createContentPrincipal(uri),
    idEspacio: uuidDeEspacio,
    tabsDeMarcado: [...document.querySelectorAll("#tabbrowser-tabs tab")],
  });
  Object.defineProperties(window.gBrowser, {
    TabMetrics: { get: () => registro.importar("moz-src:///browser/components/tabbrowser/TabMetrics.sys.mjs").TabMetrics },
    // Fluent aún no está: las cadenas de las pestañas salen de una tabla mínima (si no, el propio id).
    TabStateFlusher: { value: { flush: async () => {} } }, // no hay estado de sesión que vaciar
    tabLocalization: {
      value: {
        formatValueSync: (id) => TEXTOS_DE_PESTANAS[id] ?? id,
        formatValue: async (id) => TEXTOS_DE_PESTANAS[id] ?? id,
      },
    },
  });
  return puente;
}

// Lo que Rust sabe y Zen necesita: hoy, el buscador de `general.search_engine`.
async function configurarDesdeRust(puente) {
  if (!window.webkit?.messageHandlers?.rustron) {
    return;
  }
  const { buscador } = await puente.peticion("config");
  const { usarBuscador } = registro.importar("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  usarBuscador(new URL(buscador).hostname.replace(/^www\./, ""), buscador);
}

// Las pestañas web son vistas de Rust colocadas sobre la ventana: Rust necesita saber qué rectángulo
// ocupa el área de contenido (en píxeles CSS de la ventana) cada vez que cambia.
function avisarAreaDeContenido(puente) {
  const transporte = window.webkit?.messageHandlers?.rustron;
  const area = document.getElementById("tabbrowser-tabpanels");
  if (!transporte || !area) {
    return;
  }
  let ultimo = "";
  const enviar = () => {
    const r = area.getBoundingClientRect();
    const texto = JSON.stringify({ tipo: "area-contenido", x: Math.round(r.x), y: Math.round(r.y), ancho: Math.round(r.width), alto: Math.round(r.height) });
    if (texto !== ultimo) {
      ultimo = texto;
      transporte.postMessage(texto);
    }
  };
  new ResizeObserver(enviar).observe(area);
  window.addEventListener("resize", enviar);
  window.addEventListener("ZenCompactMode:LayoutUpdate", enviar);
  enviar();
}

async function paso(nombre, funcion) {
  try {
    await funcion();
    estado.pasos.push(`ok ${nombre}`);
  } catch (error) {
    estado.pasos.push(`FALLA ${nombre}`);
    anotar(nombre, error);
  }
}

await paso("globales", async () => {
  const defaults = await (await fetch("/shim/prefs-defaults.json")).json();
  // Preferencias de plataforma (en Firefox las define el código nativo, no los .js de prefs).
  definirGlobales({
    "ui.key.menuAccessKey": 18,
    "ui.key.accelKey": 17,
    ...defaults,
    // Los contenedores (cookies separadas por contexto) son de Gecko; WebKit no tiene equivalente.
    "privacy.userContext.enabled": false,
  });
  instalarXUL(window);
});

// La base real de los elementos de Firefox (MozXULElement, MozElements, y los elementos de toolkit
// que carga de inmediato: arrowscrollbox, tabbox, menupopup, toolbarbutton...).
await paso("customElements.js de toolkit", async () => {
  window.Services.strings = {
    // Los paquetes de cadenas (.properties) se sustituirán por la localización real; mientras, el propio id.
    createBundle: () => ({
      GetStringFromName: (nombre) => nombre,
      formatStringFromName: (nombre) => nombre,
      getSimpleEnumeration: () => [],
    }),
  };
  window.Services.env = { get: () => "", exists: () => false, set() {} };
  // Métodos de DOMParser que solo existen en Firefox.
  DOMParser.prototype.forceEnableXULXBL ??= function () {};
  DOMParser.prototype.parseFromSafeString ??= DOMParser.prototype.parseFromString;
  // Sin procesos de contenido separados (Rustron lleva WebKit): las pestañas se "seleccionan" a la vez.
  window.gMultiProcessBrowser = false;
  window.FirefoxViewHandler = { tab: null }; // Firefox View no existe
  // Lista viva de nodos de Firefox (chrome-only); un array basta para richlistbox.
  window.ChromeNodeList ??= class ChromeNodeList extends Array {};
  // El despachador de comandos de XUL: los elementos se registran para recibir updateCommands.
  document.commandDispatcher ??= {
    focusedElement: null,
    focusedWindow: window,
    addCommandUpdater() {},
    removeCommandUpdater() {},
    updateCommands() {},
  };
  // `<browser>` real (M4: contenido web de la pestaña): aún no se emula.
  const crearCallback = customElements.setElementCreationCallback;
  customElements.setElementCreationCallback = (nombre, llamada) => {
    if (nombre === "browser") {
      (estado.omitidos ??= []).push("creación de <browser>");
      return;
    }
    crearCallback(nombre, llamada);
  };
  window.MozQueryInterface = { isInstance: (f) => funcionesQI.has(f) };
  const scripts = ["customElements.js", ...SCRIPTS_DE_ELEMENTOS.map((n) => `elements/${n}.js`)].map(
    (n) => `chrome://global/content/${n}`
  );
  await precargarDe(scripts.filter((u) => !OMITIDOS.includes(u)).map((u) => leerSync(u, true)).join("\n"));
  // Propiedad nueva de Firefox: la ventana del documento de un nodo.
  if (!("documentGlobal" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "documentGlobal", {
      configurable: true,
      get() {
        return this.ownerDocument.defaultView;
      },
    });
  }
  Element.prototype.moveBefore ??= function (nodo, referencia) {
    return this.insertBefore(nodo, referencia);
  };
  window.Services.scriptloader.loadSubScript(scripts[0], window);
  definirArrowScrollbox(window);
  instalarComplementosXUL(window);
});

// ?solo=<url>: importa un único módulo en una página limpia (diagnóstico de fallos de carga).
const solo = new URLSearchParams(location.search).get("solo");
if (solo) {
  await paso(`solo ${solo}`, () => registro.precargar([solo]));
  estado.hecho = true;
}

// Módulos bajo `prefijo` que aparecen citados (también por cadena, p. ej. importESModule) en los
// módulos de partida y, de forma transitiva, en los que se vayan encontrando.
function citadosEn(prefijo, semillas) {
  const vistos = new Set();
  const cola = [...semillas];
  while (cola.length) {
    const url = cola.shift();
    if (vistos.has(url)) {
      continue;
    }
    vistos.add(url);
    let texto = "";
    try {
      texto = leerSync(url, true);
    } catch {
      continue; // el fallo de lectura se verá al precargar
    }
    for (const [citado] of texto.matchAll(ESPECIFICADORES)) {
      if (citado.startsWith(prefijo) && citado.endsWith(".mjs")) {
        cola.push(citado);
      }
    }
  }
  return [...vistos];
}

// Los elementos de pestañas de Firefox, como los carga browser-main.js (con la ventana como global).
const ELEMENTOS_DE_PESTANAS = [
  ...["tab", "tabgroup", "tabs", "tabsplitview"].map((n) => `chrome://browser/content/tabbrowser/${n}.mjs`),
  // La barra de direcciones: el lado "padre" (controlador, formateo, proveedores) que el cliente carga
  // por cadena, y el resto de módulos de la barra, antes que UrlbarInput, que al definirse ya los usa.
  ...citadosEn("moz-src:///browser/components/urlbar/", [
    "moz-src:///browser/components/urlbar/UrlbarParentController.sys.mjs",
    "moz-src:///browser/components/urlbar/UrlbarValueFormatter.sys.mjs",
    "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs",
  ]),
  "moz-src:///toolkit/components/search/SearchUtils.sys.mjs", // constantes del buscador
  "moz-src:///toolkit/components/search/ConfigSearchEngine.sys.mjs", // la barra comprueba `engine instanceof`
  "moz-src:///toolkit/components/search/SearchService.sys.mjs", // el servicio es el de shim/modulos
  ...citadosEn("chrome://browser/content/urlbar/", ["chrome://browser/content/urlbar/UrlbarInputBase.mjs"]).filter(
    (u) => !u.endsWith("/UrlbarInput.mjs")
  ),
];
if (!solo) {
  await paso("elementos de pestañas", async () => {
    await precargarDe(ELEMENTOS_DE_PESTANAS.join("\n"));
    // Después de definir tabbrowser-tab: el constructor de la clase reinicia `linkedBrowser`.
    puenteLocal = await crearPuente();
    instalarGBrowser(puenteLocal);
    await configurarDesdeRust(puenteLocal);
  });
}

// EXPERIMENTO: los scripts globales de browser.xhtml (browser.js, places, utilityOverlay...).
if (!solo && new URLSearchParams(location.search).has("global")) {
  await paso("global-scripts.js", async () => {
    await precargarDe(leerSync("chrome://browser/content/global-scripts.js", true));
    window.Services.scriptloader.loadSubScript("chrome://browser/content/global-scripts.js", window);
  });
}

// EXPERIMENTO: browser-main.js (browser-init.js con gBrowserInit y sus escuchas de arranque).
if (!solo && new URLSearchParams(location.search).has("main")) {
  await paso("browser-main.js", async () => {
    await precargarDe(leerSync("chrome://browser/content/browser-main.js", true));
    window.Services.scriptloader.loadSubScript("chrome://browser/content/browser-main.js", window);
  });
}

// Lo que browser-main.js de Firefox carga antes que los scripts de Zen.
if (!solo) {
  for (const script of ["drag-and-drop", "browser-ctrlTab"]) {
    const url = `chrome://browser/content/tabbrowser/${script}.js`;
    await paso(`precarga ${script}`, async () => precargarDe(leerSync(url, true)));
    await paso(`ejecuta ${script}`, async () => window.Services.scriptloader.loadSubScript(url, window));
  }
}

for (const script of solo ? [] : [
  "chrome://browser/content/zen-sets.js",
  "chrome://browser/content/ZenPreloadedScripts.js",
]) {
  await paso(`precarga ${script}`, async () => precargarDe(leerSync(script, true)));
  await paso(`ejecuta ${script}`, async () => window.Services.scriptloader.loadSubScript(script, window));
}

if (!solo) {
  // Dependen de clases que definen los scripts de Zen (window.ZenDragAndDrop), así que van después.
  await paso("módulos tardíos", () => precargarDe(MODULOS_TARDIOS.join("\n"), { tardio: true }));
}

if (!solo) {
  // Firefox ejecuta estos scripts antes de DOMContentLoaded; aquí ya pasó, así que se simula.
  await paso("DOMContentLoaded", async () => document.dispatchEvent(new Event("DOMContentLoaded")));
}

if (!solo) {
  // Firefox lanza este evento antes del primer layout; Zen arranca con él su disposición (gZenStartup.init).
  window.gBrowserInit ??= { delayedStartupFinished: true }; // con ?main ya existe el real (browser-init.js)
  usarMarcadoresVacios(window);
  // browser-init.js lo carga en onBeforeInitialXULLayout (aquí no se ejecuta el real: ver ?main).
  await paso("zenThemeModifier.js", async () =>
    window.Services.scriptloader.loadSubScript("chrome://browser/content/zenThemeModifier.js", window)
  );
  // Como en Firefox, el evento va primero: ZenStartup llama ahí a gZenWorkspaces.init(), que define
  // workspaceIcons, y ZenDragAndDrop.init (de tabContainer.init) lo necesita.
  // Firefox hace ambas cosas seguidas y sin ceder el turno: Zen sigue sus promesas en cuanto se cede.
  await paso("barra lateral (CustomizableUI)", async () => window.CustomizableUI.iniciarVentana(window));
  await paso("MozBeforeInitialXULLayout + gBrowser.iniciar", async () => {
    // Firefox lo lanza en el documento con burbujeo: Zen escucha tanto en document como en window.
    document.dispatchEvent(new Event("MozBeforeInitialXULLayout", { bubbles: true }));
    window.gBrowser.iniciar(document);
  });
  // En Firefox lo hace el gestor de sesión; aquí los espacios vienen del puente.
  // onWindowRestored puede quedarse esperando algo que no llega: no bloquea el diagnóstico.
  await paso("espacios de Rust -> Zen", () =>
    Promise.race([restaurarEspacios(window, puenteLocal), new Promise((r) => setTimeout(r, 3000))])
  );
  await new Promise((r) => setTimeout(r, 1500)); // lo asíncrono que Zen deja para después
  avisarAreaDeContenido(puenteLocal);
  // Fotografía del arranque de Zen (para los diagnósticos: probar-zen.sh la imprime).
  const sondear = (promesa) => {
    let estadoPromesa = "pendiente";
    promesa?.then(() => (estadoPromesa = "resuelta"), () => (estadoPromesa = "rechazada"));
    return () => estadoPromesa;
  };
  const espacios = sondear(window.gZenWorkspaces?.promiseInitialized);
  const sesion = sondear(window.SessionStore?.promiseAllWindowsRestored);
  await new Promise((r) => setTimeout(r, 0));
  estado.zen = {
    listo: window.gZenStartup?.isReady ?? null,
    antesDeCargar: document.documentElement.getAttribute("zen-before-loaded"),
    espacios: espacios(),
    sesion: sesion(),
    zenWorkspaces: document.querySelectorAll("zen-workspace").length,
    pestanas: document.querySelectorAll("tab").length,
    barraAncho: Math.round(document.getElementById("navigator-toolbox")?.getBoundingClientRect().width ?? -1),
  };
}

estado.hecho = true;
