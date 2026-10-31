// Arranque de la ventana de Zen: define los globales de Firefox, instala el emulador XUL y
// ejecuta el JS real de Zen. No se detiene en el primer fallo: anota todos los errores en
// window.__arranque para ver qué falta. Lo sirve scripts/servir-zen.py.

import { crearServices } from "./services.js";
import { RegistroModulos, crearChromeUtils } from "./chrome-utils.js";
import { instalarXUL } from "./xul.js";
import { crearXPCOMUtils } from "./xpcom-utils.js";
import { crearPathUtils, crearIOUtils, almacenEnMemoria } from "./archivos.js";
import { usarAlmacenamiento } from "./modulos/JSONFile.sys.mjs";

const almacenArchivos = almacenEnMemoria();
import { crearMozXULElement } from "./elementos-firefox.js";
import { Puente } from "./puente.js";
import { GBrowser } from "./gbrowser.js";

const LIMITE_MODULOS = 400;

const estado = (window.__arranque = { errores: [], modulos: { ok: [], fallo: [] }, pasos: [], hecho: false });

function anotar(origen, error) {
  estado.errores.push({
    origen,
    mensaje: String(error?.message ?? error),
    pila: String(error?.stack ?? "").split("\n").slice(0, 3).join(" | "),
  });
}

window.addEventListener("error", (e) => anotar("error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => anotar("promesa", e.reason));

const mapas = Object.entries(
  JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports
);
const registro = new RegistroModulos(mapas);

function leerSync(url) {
  const peticion = new XMLHttpRequest();
  peticion.open("GET", registro.resolver(url), false);
  peticion.send();
  if (peticion.status !== 200) {
    throw new Error(`HTTP ${peticion.status}: ${url}`);
  }
  return peticion.responseText;
}

// Lo que un script de Firefox espera encontrar como globales.
function definirGlobales(defaults) {
  const Services = crearServices(defaults, { ventana: window });
  Services.scriptloader = {
    loadSubScript(url, destino) {
      const codigo = `${leerSync(url)}\n//# sourceURL=${url}`;
      if (destino === window) {
        // Como en Firefox, `var` y `function` de nivel superior pasan a ser globales de la ventana.
        (0, eval)(codigo);
      } else {
        new Function(codigo).call(destino ?? window);
      }
    },
  };
  window.Services = Services;
  window.XPCOMUtils = crearXPCOMUtils(Services); // en la ventana de Firefox es un global
  // Constantes de nsIWebBrowserChrome (valores propios, solo importa que sean distintos).
  const constantes = { nsIWebBrowserChrome: { CHROME_TOOLBAR: 4, CHROME_MENUBAR: 8 } };
  window.Ci = new Proxy({}, {
    get: (_, nombre) => (typeof nombre === "string" ? { ...constantes[nombre], nombre } : undefined),
  });
  // Una ventana de navegador normal (con barras), no un popup.
  const propietario = {
    QueryInterface: () => propietario,
    getInterface: () => ({ chromeFlags: 4 | 8 }),
  };
  window.docShell = { treeOwner: propietario };
  window.Cr = new Proxy({}, { get: (_, nombre) => (typeof nombre === "string" ? nombre : undefined) });
  window.Cu = { getWeakReference: (objeto) => ({ get: () => objeto }) };
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
  window.Components = { interfaces: Ci, classes: Cc, results: Cr, utils: Cu, Exception: Error };
  window.ChromeUtils = crearChromeUtils(registro);
  // Global de la ventana de Firefox; el módulo se precarga más tarde, así que es perezoso.
  const globalesPerezosos = {
    PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
    AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
    SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  };
  for (const [nombre, url] of Object.entries(globalesPerezosos)) {
    Object.defineProperty(window, nombre, { configurable: true, get: () => registro.importar(url)[nombre] });
  }
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
  "chrome://global/content/lit-utils.mjs",
  "resource://nimbus/ExperimentAPI.sys.mjs",
  "moz-src:///zen/library/ZenLibraryWidget.sys.mjs",
  ...["Boosts", "Downloads", "History", "Media", "Search", "SpaceRouting"].map(
    (nombre) => `moz-src:///zen/library/sections/ZenLibrary${nombre}Section.mjs`
  ),
  "moz-src:///browser/components/urlbar/UrlbarPrefs.sys.mjs",
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
      lista = [...leerSync(url).matchAll(IMPORTS_ESTATICOS)].map((m) => m[1] ?? m[2]).filter(esUrlDeModulo);
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
  "moz-src:///zen/library/sections/ZenLibrarySpacesSection.mjs",
  "moz-src:///zen/library/ZenLibrary.mjs",
];

async function precargarDe(texto, { tardio = false } = {}) {
  let raices = [...texto.matchAll(ESPECIFICADORES)].map((m) => m[0]).filter((u) => u.endsWith(".mjs"));
  raices.unshift(...MODULOS_CITADOS_POR_CADENA);
  if (!tardio) {
    raices = raices.filter((u) => !MODULOS_TARDIOS.includes(u));
  }
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
      estado.modulos.fallo.push({ url, error: String(error?.message ?? error), causa: "propia", deps });
    }
  }
}

// Sin Rust (página servida sola) el puente es local: una pestaña en blanco.
function instalarGBrowser() {
  const puente = new Puente(() => {});
  puente.recibir(JSON.stringify({
    tipo: "instantanea",
    estado: {
      espacios: [{ id: 1, nombre: "Space", pestanas: [1] }],
      pestanas: [{ id: 1, titulo: "", uri: "about:blank", cargando: false, fijada: false, espacio: 1 }],
      espacioActivo: 1, pestanaActiva: 1, barraVisible: true, compacto: false, barraUrlAbierta: false,
    },
  }));
  window.gBrowser = new GBrowser(puente, {
    crearElemento: () => document.createXULElement("tab"),
    contenedor: document.getElementById("tabbrowser-tabs") ?? document.createXULElement("tabs"),
    principal: (uri) => window.Services.scriptSecurityManager.createContentPrincipal(uri),
  });
}

// customElements.setElementCreationCallback es solo de Firefox: aquí se llama al instante,
// lo que carga y registra el custom element sin esperar a su primer uso.
function instalarCreacionDeElementos() {
  customElements.setElementCreationCallback ??= (_nombre, callback) => callback();
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
  definirGlobales(defaults);
  instalarXUL(window);
  Object.assign(window, crearMozXULElement(window));
  instalarGBrowser();
  instalarCreacionDeElementos();
});

// ?solo=<url>: importa un único módulo en una página limpia (diagnóstico de fallos de carga).
const solo = new URLSearchParams(location.search).get("solo");
if (solo) {
  await paso(`solo ${solo}`, () => registro.precargar([solo]));
  estado.hecho = true;
}

// Lo que browser-main.js de Firefox carga antes que los scripts de Zen.
if (!solo) {
  await paso("precarga drag-and-drop", async () => precargarDe(leerSync("chrome://browser/content/tabbrowser/drag-and-drop.js")));
  await paso("ejecuta drag-and-drop", async () =>
    window.Services.scriptloader.loadSubScript("chrome://browser/content/tabbrowser/drag-and-drop.js", window));
}

for (const script of solo ? [] : [
  "chrome://browser/content/zen-sets.js",
  "chrome://browser/content/ZenPreloadedScripts.js",
]) {
  await paso(`precarga ${script}`, async () => precargarDe(leerSync(script)));
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

estado.hecho = true;
