// Localización de la interfaz: `document.l10n` (DOMLocalization) y `Localization` de Firefox, sobre el
// intérprete de Fluent de fluent.js. Los recursos (.ftl) los da `cargar(locale, ruta)` de forma síncrona
// (texto, o null si no existe en ese idioma): son archivos locales y así `setAttributes` traduce al
// instante, que es lo que Zen supone al leer luego los atributos.

import { Paquete } from "./fluent.js";

const XHTML = "http://www.w3.org/1999/xhtml";
const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

// Los únicos atributos que una traducción puede escribir (como L10nOverlays de Firefox).
const ATRIBUTOS = {
  [XHTML]: {
    global: ["title", "aria-label", "aria-valuetext"],
    a: ["download"],
    area: ["download", "alt"],
    input: ["alt", "placeholder"],
    menuitem: ["label"],
    menu: ["label"],
    optgroup: ["label"],
    option: ["label"],
    track: ["label"],
    img: ["alt"],
    textarea: ["placeholder"],
    th: ["abbr"],
  },
  [XUL]: {
    global: ["accesskey", "aria-label", "aria-valuetext", "label", "title", "tooltiptext"],
    description: ["value"],
    key: ["key", "keycode"],
    label: ["value"],
  },
};

// Etiquetas HTML que un mensaje puede traer dentro de su texto.
const ETIQUETAS_PERMITIDAS = new Set(["a", "em", "strong", "small", "s", "cite", "q", "dfn", "abbr", "code", "var", "samp", "kbd", "sub", "sup", "i", "b", "u", "mark", "bdi", "bdo", "span", "br", "wbr"]);

// Idiomas pedidos -> idiomas con carpeta de localización; el inglés siempre cierra la cadena.
export function elegirLocales(pedidos, disponibles = null) {
  const mapa = { es: "es-ES", pt: "pt-BR", en: "en-US", zh: "zh-CN", nb: "nb-NO", nn: "nn-NO", ga: "ga-IE" };
  const lista = [];
  for (const p of pedidos ?? []) {
    const base = p.split("-")[0];
    for (const candidato of [p, mapa[base]]) {
      if (candidato && (!disponibles || disponibles.includes(candidato)) && !lista.includes(candidato)) {
        lista.push(candidato);
      }
    }
  }
  if (!lista.includes("en-US")) {
    lista.push("en-US");
  }
  return lista;
}

export class Localizacion {
  #cargar;
  #locales;
  #ids = [];
  #paquetes = null;

  constructor(ids, { cargar, locales }) {
    this.#cargar = cargar;
    this.#locales = locales;
    this.addResourceIds(ids ?? []);
  }

  addResourceIds(ids) {
    this.#ids.push(...ids.filter((id) => !this.#ids.includes(id)));
    this.#paquetes = null;
    return this.#ids.length;
  }

  removeResourceIds(ids) {
    this.#ids = this.#ids.filter((id) => !ids.includes(id));
    this.#paquetes = null;
    return this.#ids.length;
  }

  get #lista() {
    if (!this.#paquetes) {
      this.#paquetes = this.#locales.map((loc) => {
        const paquete = new Paquete(loc);
        for (const id of this.#ids) {
          const texto = this.#cargar(loc, id);
          if (texto) {
            paquete.agregar(texto);
          }
        }
        return paquete;
      });
    }
    return this.#paquetes;
  }

  // { value, attributes: [{name, value}] } del primer idioma que tenga el mensaje, o undefined.
  mensaje(id, args = {}) {
    for (const paquete of this.#lista) {
      const m = paquete.formatearMensaje(id, args ?? {});
      if (m) {
        return { value: m.valor, attributes: Object.entries(m.atributos).map(([name, value]) => ({ name, value })) };
      }
    }
    return undefined;
  }

  formatMessagesSync(peticiones) {
    return peticiones.map((p) => this.mensaje(p.id ?? p, p.args));
  }
  formatMessages(peticiones) {
    return Promise.resolve(this.formatMessagesSync(peticiones));
  }
  formatValuesSync(peticiones) {
    return peticiones.map((p) => this.mensaje(p.id ?? p, p.args)?.value ?? null);
  }
  formatValues(peticiones) {
    return Promise.resolve(this.formatValuesSync(peticiones));
  }
  formatValueSync(id, args) {
    return this.mensaje(id, args)?.value ?? null;
  }
  formatValue(id, args) {
    return Promise.resolve(this.formatValueSync(id, args));
  }
}

export class DOMLocalizacion extends Localizacion {
  #raices = new Set();
  #observador = null;
  #pausado = false;
  #ventana;
  ready;

  constructor(ids, opciones, ventana) {
    super(ids, opciones);
    this.#ventana = ventana;
    this.ready = Promise.resolve();
  }

  // --- atributos data-l10n-*
  setAttributes(elemento, id, args) {
    elemento.setAttribute("data-l10n-id", id);
    if (args) {
      elemento.setAttribute("data-l10n-args", JSON.stringify(args));
    } else {
      elemento.removeAttribute("data-l10n-args");
    }
    this.traducirElemento(elemento); // al instante: los datos son locales
    return elemento;
  }
  getAttributes(elemento) {
    return { id: elemento.getAttribute("data-l10n-id"), args: JSON.parse(elemento.getAttribute("data-l10n-args") ?? "null") };
  }
  setArgs(elemento, args) {
    return this.setAttributes(elemento, elemento.getAttribute("data-l10n-id"), args);
  }

  // --- traducción
  traducirElemento(el) {
    const id = el.getAttribute?.("data-l10n-id");
    if (!id) {
      return;
    }
    const args = JSON.parse(el.getAttribute("data-l10n-args") ?? "null") ?? {};
    const m = this.mensaje(id, args);
    if (!m) {
      return;
    }
    const permitidos = new Set([
      ...(ATRIBUTOS[el.namespaceURI]?.global ?? []),
      ...(ATRIBUTOS[el.namespaceURI]?.[el.localName] ?? []),
      ...(el.getAttribute("data-l10n-attrs")?.split(",").map((x) => x.trim()) ?? []),
    ]);
    for (const { name, value } of m.attributes) {
      if (permitidos.has(name)) {
        el.setAttribute(name, value);
      }
    }
    if (m.value !== null) {
      this.#poner(el, m.value);
    }
  }

  #poner(el, valor) {
    if (!valor.includes("<") || !el.querySelector?.("[data-l10n-name]")) {
      if (el.textContent !== valor) {
        el.textContent = valor;
      }
      return;
    }
    // Un mensaje con marcas (<a data-l10n-name="x">...</a>): se conservan los hijos con ese nombre.
    const plantilla = el.ownerDocument.createElementNS(XHTML, "template");
    plantilla.innerHTML = valor;
    const nombrados = new Map([...el.querySelectorAll("[data-l10n-name]")].map((h) => [h.getAttribute("data-l10n-name"), h]));
    const convertir = (nodo) => {
      if (nodo.nodeType === 3) {
        return el.ownerDocument.createTextNode(nodo.textContent);
      }
      if (nodo.nodeType !== 1) {
        return null;
      }
      const nombre = nodo.getAttribute("data-l10n-name");
      if (nombre && nombrados.has(nombre)) {
        const original = nombrados.get(nombre).cloneNode(false);
        original.textContent = nodo.textContent;
        return original;
      }
      if (ETIQUETAS_PERMITIDAS.has(nodo.localName)) {
        const copia = el.ownerDocument.createElementNS(XHTML, nodo.localName);
        nodo.childNodes.forEach((h) => copia.append(convertir(h) ?? ""));
        return copia;
      }
      return el.ownerDocument.createTextNode(nodo.textContent);
    };
    el.replaceChildren(...[...plantilla.content.childNodes].map(convertir).filter(Boolean));
  }

  translateElements(elementos) {
    for (const el of elementos) {
      this.traducirElemento(el);
    }
    return Promise.resolve();
  }

  translateFragment(raiz) {
    if (raiz.hasAttribute?.("data-l10n-id")) {
      this.traducirElemento(raiz);
    }
    raiz.querySelectorAll("[data-l10n-id]").forEach((el) => this.traducirElemento(el));
    return Promise.resolve();
  }

  translateRoots() {
    return Promise.all([...this.#raices].map((r) => this.translateFragment(r)));
  }

  // --- raíces observadas
  connectRoot(raiz) {
    if (this.#raices.has(raiz)) {
      return;
    }
    this.#raices.add(raiz);
    this.translateFragment(raiz);
    this.#observador ??= new this.#ventana.MutationObserver((cambios) => {
      if (this.#pausado) {
        return;
      }
      for (const c of cambios) {
        if (c.type === "attributes") {
          this.traducirElemento(c.target);
        } else {
          c.addedNodes.forEach((n) => n.nodeType === 1 && this.translateFragment(n));
        }
      }
    });
    this.#observador.observe(raiz, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-l10n-id", "data-l10n-args"],
    });
  }
  disconnectRoot(raiz) {
    this.#raices.delete(raiz);
  }
  pauseObserving() {
    this.#pausado = true;
  }
  resumeObserving() {
    this.#pausado = false;
    return this.translateRoots();
  }
  get roots() {
    return this.#raices;
  }
}

// Instala window.Localization, window.DOMLocalization y document.l10n con los <link rel="localization">
// del documento. `cargar(locale, ruta)` da el texto de un .ftl o null.
export function instalarL10n(ventana, { cargar, locales }) {
  const documento = ventana.document;
  const opciones = { cargar, locales };
  ventana.Localization = class extends Localizacion {
    constructor(ids) {
      super(ids, opciones);
    }
  };
  ventana.DOMLocalization = class extends DOMLocalizacion {
    constructor(ids) {
      super(ids, opciones, ventana);
    }
  };
  const ids = [...documento.querySelectorAll('link[rel="localization"]')].map((l) => l.getAttribute("href"));
  const l10n = new DOMLocalizacion(ids, opciones, ventana);
  Object.defineProperty(documento, "l10n", { configurable: true, value: l10n });
  l10n.connectRoot(documento.documentElement);
  return l10n;
}
