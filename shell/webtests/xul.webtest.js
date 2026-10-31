// Pruebas del emulador XUL. Se ejecutan dentro de WebKit (no hay DOM en Node):
// scripts/probar-webkit.sh las concatena tras el shim y lee window.__resultado.
// Aquí `instalarXUL` y `mejorar` son globales (el script quita los `export`).

const NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const xul = (nombre, attrs = {}) => {
  const e = document.createElementNS(NS, nombre);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

instalarXUL(window);

prueba("createXULElement crea elementos XUL mejorados", () => {
  const b = document.createXULElement("toolbarbutton");
  igual(b.namespaceURI, NS);
  igual(b.localName, "toolbarbutton");
  igual(b instanceof XULElement, true);
  igual(document.createElement("div") instanceof XULElement, false);
});

prueba("hidden, disabled y collapsed reflejan atributos", () => {
  const e = document.createXULElement("hbox");
  igual(e.hidden, false);
  e.hidden = true;
  igual(e.getAttribute("hidden") !== null, true);
  igual(e.hidden, true);
  e.hidden = false;
  igual(e.hasAttribute("hidden"), false);
  e.setAttribute("disabled", "true");
  igual(e.disabled, true);
  e.setAttribute("disabled", "false");
  igual(e.disabled, false);
});

prueba("label, image, value y checked se reflejan", () => {
  const b = document.createXULElement("toolbarbutton");
  igual(b.label, "");
  b.label = "Nueva pestaña";
  b.image = "chrome://x.svg";
  igual(b.getAttribute("label"), "Nueva pestaña");
  igual(b.getAttribute("image"), "chrome://x.svg");
  b.checked = true;
  igual(b.checked, true);
  b.tooltipText = "ayuda";
  igual(b.getAttribute("tooltiptext"), "ayuda");
});

prueba("style escribe y lee el atributo style", () => {
  const e = document.createXULElement("vbox");
  e.style.width = "120px";
  e.style.setProperty("--zen-var", "7");
  igual(e.getAttribute("style").includes("width: 120px"), true);
  igual(e.style.getPropertyValue("--zen-var"), "7");
  igual(e.style.width, "120px");
  e.style.removeProperty("width");
  igual(e.style.width, "");
  e.setAttribute("style", "height: 5px");
  igual(e.style.height, "5px");
  e.style.cssText = "";
  igual(e.hasAttribute("style"), false);
});

prueba("dataset usa atributos data-*", () => {
  const e = document.createXULElement("vbox");
  e.dataset.zenId = "a1";
  igual(e.getAttribute("data-zen-id"), "a1");
  igual(e.dataset.zenId, "a1");
  igual("zenId" in e.dataset, true);
  delete e.dataset.zenId;
  igual(e.hasAttribute("data-zen-id"), false);
});

prueba("click() despacha un evento click que burbujea", () => {
  const padre = document.createXULElement("hbox");
  const hijo = document.createXULElement("toolbarbutton");
  padre.append(hijo);
  let n = 0;
  padre.addEventListener("click", () => n++);
  hijo.click();
  igual(n, 1);
});

prueba("tabs: selectedIndex marca una sola pestaña y dispara select", () => {
  const tabs = document.createXULElement("tabs");
  const [a, b, c] = ["a", "b", "c"].map(() => document.createXULElement("tab"));
  tabs.append(a, b, c);
  let selects = 0;
  tabs.addEventListener("select", () => selects++);
  tabs.selectedIndex = 1;
  igual([a.selected, b.selected, c.selected], [false, true, false]);
  igual(tabs.selectedItem === b, true);
  tabs.selectedIndex = 1; // sin cambio: no dispara
  tabs.selectedItem = c;
  igual(tabs.selectedIndex, 2);
  igual(selects, 2);
  igual(tabs.allTabs.length, 3);
});

prueba("tabbox enlaza tabs y tabpanels", () => {
  const caja = document.createXULElement("tabbox");
  const tabs = document.createXULElement("tabs");
  const paneles = document.createXULElement("tabpanels");
  tabs.append(document.createXULElement("tab"), document.createXULElement("tab"));
  paneles.append(document.createXULElement("tabpanel"), document.createXULElement("tabpanel"));
  caja.append(tabs, paneles);
  caja.selectedIndex = 1;
  igual(tabs.selectedIndex, 1);
  igual(paneles.selectedIndex, 1);
  igual(paneles.selectedPanel === paneles.children[1], true);
  igual(paneles.children[0].hasAttribute("selected"), false);
});

prueba("popups: estado y orden de eventos", () => {
  const p = document.createXULElement("menupopup");
  const orden = [];
  for (const ev of ["popupshowing", "popupshown", "popuphiding", "popuphidden"]) {
    p.addEventListener(ev, () => orden.push(ev));
  }
  igual(p.state, "closed");
  const ancla = document.createXULElement("toolbarbutton");
  p.openPopup(ancla, "after_start");
  igual(p.state, "open");
  igual(p.getAttribute("state"), "open");
  igual(p.anchorNode === ancla, true);
  p.openPopup(ancla); // ya abierto: no repite
  p.hidePopup();
  p.hidePopup(); // ya cerrado: no repite
  igual(p.state, "closed");
  igual(orden, ["popupshowing", "popupshown", "popuphiding", "popuphidden"]);
});

prueba("los elementos que entran al documento se mejoran (MutationObserver)", async () => {
  const e = xul("hbox");
  igual(e instanceof XULElement, false);
  document.body.append(e);
  await Promise.resolve();
  igual(e instanceof XULElement, true);
  e.hidden = true;
  igual(e.hidden, true);

  // También los descendientes de un subárbol insertado.
  const raiz = xul("vbox");
  const hijo = xul("toolbarbutton", { label: "x" });
  raiz.append(hijo);
  document.body.append(raiz);
  await Promise.resolve();
  igual(hijo.label, "x");
  e.remove();
  raiz.remove();
});

prueba("un elemento no XUL o desconocido no se toca", () => {
  const div = document.createElement("div");
  igual(mejorar(div) === div && !("hidden" in Object.getOwnPropertyDescriptors(div)), true);
  const raro = xul("elemento-inventado");
  mejorar(raro);
  igual(raro instanceof XULElement, false);
});

// --- Clases reales sobre elementos XUL ---
const esperar = () => new Promise((r) => setTimeout(r, 0));

prueba("customElements.define con extends registra la clase y createXULElement{is} la aplica", () => {
  class MiTab extends XULElement {
    #privado = 7;
    campo = "c";
    constructor() {
      super();
      this.construido = true;
    }
    get privado() {
      return this.#privado;
    }
    saluda() {
      return "hola " + this.localName;
    }
  }
  customElements.define("mi-tab", MiTab, { extends: "tab" });
  const t = document.createXULElement("tab", { is: "mi-tab" });
  igual(t instanceof MiTab, true);
  igual(t instanceof XULElement, true);
  igual(t.construido, true);
  igual(t.campo, "c");
  igual(t.privado, 7);
  igual(t.saluda(), "hola tab");
  igual(t.namespaceURI, NS);
  igual(customElements.get("mi-tab") === MiTab, true);
  igual(document.createXULElement("tab") instanceof MiTab, false);
});

prueba("los miembros de la clase mandan sobre los de la base de xul.js", () => {
  class Etiqueta extends XULElement {
    get label() {
      return "desde clase";
    }
  }
  customElements.define("etiqueta-x", Etiqueta);
  const e = document.createXULElement("etiqueta-x");
  igual(e.label, "desde clase");
  igual(e.hidden, false); // lo nativo de XUL sigue ahí
  e.hidden = true;
  igual(e.hasAttribute("hidden"), true);
});

prueba("los accesores de HTMLElement no fallan en elementos envueltos", () => {
  class Sombras extends XULElement {}
  customElements.define("sombras-x", Sombras);
  const e = document.createXULElement("sombras-x");
  e.title = "T";
  igual(e.title, "T");
  igual(e.getAttribute("title"), "T");
  e.textContent = "hola";
  igual(e.innerText, "hola");
  igual(typeof e.offsetWidth, "number");
  igual(e.draggable, false);
  e.draggable = true;
  igual(e.hasAttribute("draggable"), true);
  let clic = 0;
  e.onclick = () => clic++;
  e.click();
  igual(clic, 1);
  e.onclick = null;
  e.click();
  igual(clic, 1);
});

prueba("connectedCallback, disconnectedCallback y attributeChangedCallback se llaman", async () => {
  const eventos = [];
  class Ciclo extends XULElement {
    static get observedAttributes() {
      return ["estado"];
    }
    connectedCallback() {
      eventos.push("conectado");
    }
    disconnectedCallback() {
      eventos.push("desconectado");
    }
    attributeChangedCallback(nombre, antes, ahora) {
      eventos.push(`${nombre}:${antes}->${ahora}`);
    }
  }
  customElements.define("ciclo-x", Ciclo);
  const e = document.createXULElement("ciclo-x");
  document.body.append(e);
  await esperar();
  e.setAttribute("estado", "a");
  e.setAttribute("otro", "ignorado");
  await esperar();
  e.remove();
  await esperar();
  igual(eventos, ["conectado", "estado:null->a", "desconectado"]);
});

prueba("los elementos ya existentes pasan a la clase real al registrarla", async () => {
  const hijo = document.createXULElement("hbox");
  const previo = xul("tardio-x");
  previo.append(hijo);
  document.body.append(previo);
  await esperar();
  igual(previo instanceof XULElement, false);
  let conectado = 0;
  class Tardio extends XULElement {
    #n = 3;
    get n() {
      return this.#n;
    }
    connectedCallback() {
      conectado++;
    }
  }
  customElements.define("tardio-x", Tardio);
  igual(previo instanceof Tardio, true);
  igual(previo.n, 3);
  igual(conectado, 1);
  igual(hijo.parentNode === previo, true);
  previo.remove();
});

prueba("un nombre con guion también funciona como elemento HTML", () => {
  class Doble extends XULElement {
    get quien() {
      return "doble";
    }
  }
  customElements.define("doble-x", Doble);
  const h = document.createElement("doble-x");
  igual(h instanceof Doble, true);
  igual(h.quien, "doble");
  igual(typeof h.style.cssText, "string");
});

// --- Inserción síncrona, `is` y creación diferida ---
prueba("append conecta al instante, sin esperar al MutationObserver", () => {
  const eventos = [];
  class Sync extends XULElement {
    connectedCallback() {
      eventos.push("conectado");
    }
    disconnectedCallback() {
      eventos.push("desconectado");
    }
  }
  customElements.define("sync-x", Sync);
  const e = document.createXULElement("sync-x");
  document.body.append(e);
  igual(eventos, ["conectado"]);
  e.remove();
  igual(eventos, ["conectado", "desconectado"]);
});

prueba("los hijos de un fragmento se mejoran y conectan al insertar el fragmento", () => {
  let conectados = 0;
  class Hijo extends XULElement {
    connectedCallback() {
      conectados++;
    }
  }
  customElements.define("hijo-x", Hijo);
  const fragmento = document.createDocumentFragment();
  fragmento.append(document.createXULElement("hijo-x"), document.createXULElement("hijo-x"));
  document.body.append(fragmento);
  igual(conectados, 2);
  document.querySelectorAll("hijo-x").forEach((h) => h.remove());
});

prueba("cloneNode e importNode devuelven elementos con su clase", () => {
  class Clon extends XULElement {
    get marca() {
      return "clon";
    }
  }
  customElements.define("clon-x", Clon);
  const original = document.createXULElement("clon-x");
  igual(original.cloneNode(true).marca, "clon");
  igual(document.importNode(original, true).marca, "clon");
});

prueba("un elemento con `is` no se envuelve con la clase de su etiqueta", () => {
  class DeEtiqueta extends XULElement {
    get quien() {
      return "etiqueta";
    }
  }
  class DeIs extends DeEtiqueta {
    get quien() {
      return "is";
    }
  }
  customElements.define("pieza", DeEtiqueta);
  const con = document.createXULElement("pieza", { is: "pieza-is" });
  igual(con instanceof DeEtiqueta, false);
  customElements.define("pieza-is", DeIs, { extends: "pieza" });
  document.body.append(con);
  igual(con.quien, "is");
  con.remove();
  igual(document.createXULElement("pieza").quien, "etiqueta");
});

prueba("setElementCreationCallback espera al primer elemento y un fallo no interrumpe", async () => {
  let llamadas = 0;
  customElements.setElementCreationCallback("tardio-y", () => {
    llamadas++;
  });
  igual(llamadas, 0);
  document.createXULElement("tardio-y");
  igual(llamadas, 1);
  document.createXULElement("tardio-y");
  igual(llamadas, 1);
  customElements.setElementCreationCallback("roto-y", () => {
    throw new Error("falla");
  });
  let errores = 0; // desde file:// WebKit oculta el mensaje ("Script error."), solo cuenta que se informe
  const alError = (e) => (errores++, e.preventDefault());
  window.addEventListener("error", alError);
  document.createXULElement("roto-y"); // no lanza
  await esperar();
  window.removeEventListener("error", alError);
  igual(errores, 1);
});
