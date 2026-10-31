// Emulación de elementos XUL sobre WebKit.
//
// En WebKit los elementos XUL de browser.xhtml son `Element` genéricos: no tienen `style`,
// `hidden`, `dataset` ni `click()`, y sus nombres (tab, toolbarbutton...) no admiten
// customElements.define por no llevar guion. En lugar de registrar clases, cada elemento
// "se mejora": se le copian como propiedades propias los miembros de su clase, al crearse con
// createXULElement o al entrar en el documento. Los selectores CSS de Zen no se tocan.

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MEJORADO = Symbol("rustron.xul");

// Atributos booleanos de XUL: presentes con "true" o vacíos significan verdadero.
const esVerdadero = (valor) => valor !== null && valor !== "false";

class ElementoXUL {
  get hidden() {
    return esVerdadero(this.getAttribute("hidden"));
  }
  set hidden(valor) {
    this.toggleAttribute("hidden", !!valor);
  }

  get collapsed() {
    return esVerdadero(this.getAttribute("collapsed"));
  }
  set collapsed(valor) {
    this.toggleAttribute("collapsed", !!valor);
  }

  get disabled() {
    return esVerdadero(this.getAttribute("disabled"));
  }
  set disabled(valor) {
    this.toggleAttribute("disabled", !!valor);
  }

  get tooltipText() {
    return this.getAttribute("tooltiptext") ?? "";
  }
  set tooltipText(valor) {
    this.setAttribute("tooltiptext", valor);
  }

  get tabIndex() {
    return Number(this.getAttribute("tabindex") ?? -1);
  }
  set tabIndex(valor) {
    this.setAttribute("tabindex", String(valor));
  }

  // dataset: el acceso por propiedad se traduce a atributos data-*.
  get dataset() {
    const el = this;
    const clave = (nombre) => "data-" + String(nombre).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    return new Proxy(
      {},
      {
        get: (_, nombre) => el.getAttribute(clave(nombre)) ?? undefined,
        set: (_, nombre, valor) => (el.setAttribute(clave(nombre), String(valor)), true),
        has: (_, nombre) => el.hasAttribute(clave(nombre)),
        deleteProperty: (_, nombre) => (el.removeAttribute(clave(nombre)), true),
      }
    );
  }

  // style: un CSSStyleDeclaration auxiliar sincronizado con el atributo `style`.
  get style() {
    if (!this[MEJORADO].estilo) {
      const auxiliar = this.ownerDocument.createElementNS(XHTML_NS, "div").style;
      const el = this;
      const leer = () => (auxiliar.cssText = el.getAttribute("style") ?? "");
      const guardar = () => {
        const css = auxiliar.cssText;
        css ? el.setAttribute("style", css) : el.removeAttribute("style");
      };
      this[MEJORADO].estilo = new Proxy(auxiliar, {
        get(destino, nombre) {
          leer();
          const valor = Reflect.get(destino, nombre, destino);
          if (typeof valor !== "function") {
            return valor;
          }
          return (...argumentos) => {
            const resultado = valor.apply(destino, argumentos);
            guardar();
            return resultado;
          };
        },
        set(destino, nombre, valor) {
          leer();
          const ok = Reflect.set(destino, nombre, valor, destino);
          guardar();
          return ok;
        },
      });
    }
    return this[MEJORADO].estilo;
  }

  click() {
    this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: this.ownerDocument.defaultView }));
  }

  focus() {
    this.ownerDocument.defaultView?.__rustronEnfocado?.(this);
    this.setAttribute("focused", "true");
  }

  blur() {
    this.removeAttribute("focused");
  }
}

// Elementos con `label`, `image`, `value` y `checked` reflejados en atributos.
class ElementoEtiquetado extends ElementoXUL {
  get label() {
    return this.getAttribute("label") ?? "";
  }
  set label(valor) {
    this.setAttribute("label", valor);
  }

  get image() {
    return this.getAttribute("image") ?? "";
  }
  set image(valor) {
    this.setAttribute("image", valor);
  }

  get value() {
    return this.getAttribute("value") ?? "";
  }
  set value(valor) {
    this.setAttribute("value", valor);
  }

  get checked() {
    return esVerdadero(this.getAttribute("checked"));
  }
  set checked(valor) {
    this.toggleAttribute("checked", !!valor);
  }
}

// <tab>: `selected` y `pinned` son atributos; `visuallyselected` lo gestiona el código de pestañas.
class Tab extends ElementoEtiquetado {
  get selected() {
    return esVerdadero(this.getAttribute("selected"));
  }
  set selected(valor) {
    this.toggleAttribute("selected", !!valor);
  }

  get pinned() {
    return esVerdadero(this.getAttribute("pinned"));
  }
  set pinned(valor) {
    this.toggleAttribute("pinned", !!valor);
  }

  get visuallySelected() {
    return esVerdadero(this.getAttribute("visuallyselected"));
  }
}

// <tabs>: contiene <tab>. Seleccionar una pestaña dispara `select`.
class Tabs extends ElementoXUL {
  get allTabs() {
    return [...this.querySelectorAll("tab")];
  }

  get selectedIndex() {
    return this.allTabs.findIndex((t) => t.selected);
  }
  set selectedIndex(indice) {
    const pestanas = this.allTabs;
    const nueva = pestanas[indice];
    if (!nueva || nueva.selected) {
      return;
    }
    for (const t of pestanas) {
      t.selected = t === nueva;
    }
    this.dispatchEvent(new Event("select", { bubbles: true }));
  }

  get selectedItem() {
    return this.allTabs.find((t) => t.selected) ?? null;
  }
  set selectedItem(tab) {
    this.selectedIndex = this.allTabs.indexOf(tab);
  }
}

// <tabpanels>: muestra un solo <tabpanel>/hijo según selectedIndex.
class TabPanels extends ElementoXUL {
  get selectedIndex() {
    return Number(this.getAttribute("selectedIndex") ?? 0);
  }
  set selectedIndex(indice) {
    this.setAttribute("selectedIndex", String(indice));
    [...this.children].forEach((hijo, i) => hijo.toggleAttribute("selected", i === indice));
  }

  get selectedPanel() {
    return this.children[this.selectedIndex] ?? null;
  }
  set selectedPanel(panel) {
    this.selectedIndex = [...this.children].indexOf(panel);
  }
}

// <tabbox>: enlaza su <tabs> con sus <tabpanels>.
class TabBox extends ElementoXUL {
  get tabs() {
    return this.ownerDocument.getElementById(this.getAttribute("tabcontainer") ?? "") ?? this.querySelector("tabs");
  }
  get tabpanels() {
    return this.querySelector("tabpanels");
  }
  get selectedIndex() {
    return this.tabs?.selectedIndex ?? -1;
  }
  set selectedIndex(indice) {
    if (this.tabs) {
      this.tabs.selectedIndex = indice;
    }
    if (this.tabpanels) {
      this.tabpanels.selectedIndex = indice;
    }
  }
}

// <menupopup>, <panel>, <tooltip>: estado y eventos como los de Firefox.
class Popup extends ElementoXUL {
  get state() {
    return this[MEJORADO].estado ?? "closed";
  }

  openPopup(ancla, posicion) {
    if (this.state === "open") {
      return;
    }
    this.dispatchEvent(new Event("popupshowing", { bubbles: true, cancelable: true }));
    this[MEJORADO].estado = "open";
    this[MEJORADO].ancla = ancla ?? null;
    this[MEJORADO].posicion = posicion ?? null;
    this.setAttribute("state", "open");
    this.dispatchEvent(new Event("popupshown", { bubbles: true }));
  }

  hidePopup() {
    if (this.state !== "open") {
      return;
    }
    this.dispatchEvent(new Event("popuphiding", { bubbles: true, cancelable: true }));
    this[MEJORADO].estado = "closed";
    this.removeAttribute("state");
    this.dispatchEvent(new Event("popuphidden", { bubbles: true }));
  }

  get anchorNode() {
    return this[MEJORADO].ancla ?? null;
  }
}

const CLASES = {
  tab: Tab,
  tabs: Tabs,
  tabbox: TabBox,
  tabpanels: TabPanels,
  menupopup: Popup,
  panel: Popup,
  tooltip: Popup,
  toolbarbutton: ElementoEtiquetado,
  button: ElementoEtiquetado,
  menuitem: ElementoEtiquetado,
  menu: ElementoEtiquetado,
  checkbox: ElementoEtiquetado,
  label: ElementoEtiquetado,
  description: ElementoEtiquetado,
  image: ElementoEtiquetado,
  menulist: ElementoEtiquetado,
};

// Resto de elementos XUL de la ventana: solo la base.
const SOLO_BASE = [
  "box", "hbox", "vbox", "stack", "spacer", "toolbox", "toolbar", "toolbaritem", "toolbarspring",
  "toolbarseparator", "toolbartabstop", "menuseparator", "arrowscrollbox", "scrollbox",
  "panelview", "panelmultiview", "popupnotification", "popupnotificationcontent", "splitter",
  "deck", "richlistbox", "richlistitem", "tabpanel", "popupset", "commandset", "keyset",
  "command", "key", "observes", "stringbundle", "stringbundleset", "menucaption", "menugroup",
  "menubar", "popupnotificationheader", "linkset",
];

// Los miembros de una clase y de sus ascendientes, listos para copiar a una instancia.
const descriptoresDe = new Map();

function descriptores(Clase) {
  if (!descriptoresDe.has(Clase)) {
    const cadena = [];
    for (let c = Clase; c?.prototype; c = Object.getPrototypeOf(c)) {
      cadena.unshift(c);
    }
    const todos = {};
    for (const c of cadena) {
      Object.assign(todos, Object.getOwnPropertyDescriptors(c.prototype));
    }
    delete todos.constructor;
    descriptoresDe.set(Clase, todos);
  }
  return descriptoresDe.get(Clase);
}

function claseDe(nombre) {
  return CLASES[nombre] ?? (SOLO_BASE.includes(nombre) ? ElementoXUL : null);
}

export function mejorar(elemento) {
  if (elemento[MEJORADO] || elemento.namespaceURI !== XUL_NS) {
    return elemento;
  }
  const Clase = claseDe(elemento.localName);
  if (!Clase) {
    return elemento;
  }
  Object.defineProperty(elemento, MEJORADO, { value: {} });
  Object.defineProperties(elemento, descriptores(Clase));
  return elemento;
}

function mejorarArbol(nodo) {
  if (nodo.nodeType !== 1) {
    return;
  }
  mejorar(nodo);
  for (const hijo of nodo.querySelectorAll("*")) {
    mejorar(hijo);
  }
}

// Instala createXULElement y mejora el documento, ahora y según vayan entrando elementos.
export function instalarXUL(ventana) {
  const documento = ventana.document;
  documento.createXULElement = (nombre) => mejorar(documento.createElementNS(XUL_NS, nombre));

  // `instanceof XULElement` es cierto para cualquier elemento mejorado.
  ventana.XULElement = class XULElement {
    static [Symbol.hasInstance](objeto) {
      return !!objeto?.[MEJORADO];
    }
  };

  mejorarArbol(documento.documentElement);
  const observador = new ventana.MutationObserver((cambios) => {
    for (const cambio of cambios) {
      cambio.addedNodes.forEach(mejorarArbol);
    }
  });
  observador.observe(documento, { childList: true, subtree: true });
  return observador;
}
