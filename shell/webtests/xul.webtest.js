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
