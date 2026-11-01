import test from "node:test";
import assert from "node:assert/strict";

import { Puente } from "../shim/puente.js";
import { GBrowser } from "../shim/gbrowser.js";

class Elemento extends EventTarget {
  tagName;
  hijos = [];
  atributos = new Map();
  constructor(tagName) {
    super();
    this.tagName = tagName;
  }
  appendChild(hijo) {
    this.hijos.push(hijo);
    hijo.padre = this;
  }
  remove() {
    this.padre?.hijos.splice(this.padre.hijos.indexOf(this), 1);
  }
  getAttribute(n) {
    return this.atributos.get(n) ?? null;
  }
  setAttribute(n, v) {
    this.atributos.set(n, String(v));
  }
  hasAttribute(n) {
    return this.atributos.has(n);
  }
  removeAttribute(n) {
    this.atributos.delete(n);
  }
  toggleAttribute(n, forzar) {
    forzar ? this.atributos.set(n, "") : this.atributos.delete(n);
  }
  get pinned() {
    return this.hasAttribute("pinned");
  }
  get hidden() {
    return this.hasAttribute("hidden");
  }
}

const pestana = (id, extra = {}) => ({
  id, titulo: `t${id}`, uri: `https://p${id}.com/`, cargando: false, fijada: false, espacio: 1, ...extra,
});

function montar(pestanas = [pestana(1), pestana(2)], activa = 1) {
  const enviados = [];
  const puente = new Puente((t) => enviados.push(JSON.parse(t)));
  const contenedor = new Elemento("tabs");
  const gb = new GBrowser(puente, {
    crearElemento: () => new Elemento("tab"),
    contenedor,
    principal: (uri) => ({ spec: uri.spec }),
  });
  puente.recibir(JSON.stringify({
    tipo: "instantanea",
    estado: {
      espacios: [{ id: 1, nombre: "S", pestanas: pestanas.map((p) => p.id) }],
      pestanas, espacioActivo: 1, pestanaActiva: activa,
      barraVisible: true, compacto: false, barraUrlAbierta: false,
    },
  }));
  const recibir = (m) => puente.recibir(JSON.stringify(m));
  return { gb, puente, contenedor, enviados, recibir };
}

test("la instantánea crea un <tab> por pestaña, en orden y con la activa seleccionada", () => {
  const { gb, contenedor } = montar();
  assert.deepEqual(gb.tabs.map((t) => t.rustronId), [1, 2]);
  assert.equal(contenedor.hijos.length, 2);
  assert.equal(gb.selectedTab.rustronId, 1);
  assert.equal(gb.selectedTab.getAttribute("label"), "t1");
  assert.equal(gb.selectedTab.hasAttribute("selected"), true);
  assert.equal(gb.tabs[1].hasAttribute("selected"), false);
});

test("selectedBrowser expone URI, título y principal de la pestaña", () => {
  const { gb } = montar();
  assert.equal(gb.currentURI.spec, "https://p1.com/");
  assert.equal(gb.contentTitle, "t1");
  assert.equal(gb.selectedBrowser.contentPrincipal.spec, "https://p1.com/");
  assert.equal(gb.getTabForBrowser(gb.selectedBrowser), gb.selectedTab);
  assert.equal(gb.getBrowserForTab(gb.tabs[1]).contentTitle, "t2");
});

test("las acciones salen hacia Rust y no cambian nada hasta que Rust responde", () => {
  const { gb, enviados } = montar();
  gb.selectedTab = gb.tabs[1];
  gb.removeTab(gb.tabs[0]);
  gb.loadURI("https://x.com", { tab: gb.tabs[1] });
  assert.deepEqual(enviados.map((m) => m.accion), [
    { nombre: "activar-pestana", pestana: 2 },
    { nombre: "cerrar-pestana", pestana: 1 },
    { nombre: "navegar", pestana: 2, texto: "https://x.com" },
  ]);
  assert.equal(gb.selectedTab.rustronId, 1);
  assert.equal(gb.tabs.length, 2);
});

test("TabOpen, TabSelect y TabClose se emiten en la pestaña", () => {
  const { gb, recibir } = montar();
  const eventos = [];
  const marcar = (tab) => ["TabOpen", "TabSelect", "TabClose"].forEach((t) => tab.addEventListener(t, () => eventos.push(`${t}:${tab.rustronId}`)));
  gb.tabs.forEach(marcar);
  recibir({ tipo: "pestana-activada", id: 2 });
  assert.deepEqual(eventos, ["TabSelect:2"]);
  assert.equal(gb.tabs[0].hasAttribute("selected"), false);
  recibir({ tipo: "pestana-cerrada", id: 1 });
  assert.deepEqual(eventos.slice(1), ["TabClose:1"]);
  assert.deepEqual(gb.tabs.map((t) => t.rustronId), [2]);
});

test("cerrar quita la pestaña de tabs y del contenedor", () => {
  const { gb, contenedor, recibir } = montar();
  recibir({ tipo: "pestana-cerrada", id: 1 });
  recibir({ tipo: "espacios", espacios: [{ id: 1, nombre: "S", pestanas: [2] }] });
  assert.deepEqual(gb.tabs.map((t) => t.rustronId), [2]);
  assert.equal(contenedor.hijos.length, 1);
});

test("addTab devuelve ya la pestaña y la adopta cuando Rust crea la suya", () => {
  const { gb, enviados, recibir, contenedor } = montar();
  const abiertas = [];
  contenedor.addEventListener("TabOpen", (e) => abiertas.push(e.target));
  const tab = gb.addTab("https://nueva.com/");
  assert.deepEqual(enviados.at(-1).accion, { nombre: "nueva-pestana", uri: "https://nueva.com/" });
  assert.equal(tab.rustronId, null);
  recibir({ tipo: "pestana-creada", pestana: pestana(3, { uri: "https://nueva.com/" }) });
  recibir({ tipo: "espacios", espacios: [{ id: 1, nombre: "S", pestanas: [1, 2, 3] }] });
  assert.equal(tab.rustronId, 3);
  assert.equal(gb.tabs.at(-1), tab);
  assert.equal(gb.tabs.length, 3);
});

test("cambiar la URL avisa a los oyentes de progreso; el título actualiza la etiqueta", () => {
  const { gb, recibir } = montar();
  const urls = [];
  gb.addTabsProgressListener({ onLocationChange: (nav, _p, _r, uri) => urls.push([nav.pestana.rustronId, uri.spec]) });
  recibir({ tipo: "pestana-actualizada", pestana: pestana(1, { uri: "https://otra.com/", titulo: "Otra" }) });
  assert.deepEqual(urls, [[1, "https://otra.com/"]]);
  assert.equal(gb.tabs[0].getAttribute("label"), "Otra");
});

test("pinTab marca la pestaña (solo local) y la cuenta", () => {
  const { gb } = montar();
  gb.pinTab(gb.tabs[1]);
  assert.equal(gb.pinnedTabCount, 1);
  gb.unpinTab(gb.tabs[1]);
  assert.equal(gb.pinnedTabCount, 0);
});

test("los predicados reconocen tab, tab-group y zen-folder", () => {
  assert.equal(GBrowser.isTab(new Elemento("tab")), true);
  assert.equal(GBrowser.isTabGroup(new Elemento("zen-folder")), true);
  assert.equal(GBrowser.isTab(new Elemento("box")), false);
  assert.equal(GBrowser.isTab(null), false);
});

test("actuar sobre una pestaña sin id de Rust falla en voz alta", () => {
  const { gb } = montar();
  const tab = gb.addTab("https://pendiente.com/");
  assert.throws(() => gb.removeTab(tab), /aún no tiene id de Rust/);
});

test("la pestaña vacía de Zen es local: no se pide a Rust y se puede seleccionar sin tocar a Rust", () => {
  const { gb, enviados, recibir } = montar();
  const antes = enviados.length;
  const vacia = gb.addTab("about:blank", { _forZenEmptyTab: true });
  assert.equal(vacia.hasAttribute("zen-empty-tab"), true);
  assert.equal(enviados.length, antes, "no se envía ninguna acción a Rust");
  assert.equal(gb.tabs.at(-1), vacia, "Zen la encuentra en gBrowser.tabs");
  gb.selectedTab = vacia;
  assert.equal(gb.selectedTab, vacia);
  assert.equal(enviados.length, antes);
  // Cuando Rust activa otra pestaña, manda Rust.
  recibir({ tipo: "pestana-activada", id: 2 });
  assert.equal(gb.selectedTab.rustronId, 2);
  assert.equal(vacia.hasAttribute("selected"), false);
});

test("el icono de Rust se pone y se quita en la pestaña", () => {
  const { gb, recibir } = montar();
  const tab = gb.tabs[0];
  assert.equal(tab.hasAttribute("image"), false);
  recibir({ tipo: "pestana-actualizada", pestana: pestana(1, { icono: "data:image/png;base64,AAAA" }) });
  assert.equal(tab.getAttribute("image"), "data:image/png;base64,AAAA");
  recibir({ tipo: "pestana-actualizada", pestana: pestana(1, { icono: null }) });
  assert.equal(tab.hasAttribute("image"), false);
});

test("pestañas a un lado de una dada, sin las fijadas, y recargar/duplicar una concreta", () => {
  const { gb, enviados } = montar([pestana(1), pestana(2), pestana(3), pestana(4, { fijada: true })], 2);
  for (const t of gb.tabs) {
    Object.defineProperty(t, "visible", { value: true });
  }
  assert.deepEqual(gb._getTabsToTheStartFrom(gb.tabs[2]).map((t) => t.rustronId), [1, 2]);
  assert.deepEqual(gb._getTabsToTheEndFrom(gb.tabs[0]).map((t) => t.rustronId), [2, 3], "la 4 está fijada");
  gb.reloadTab(gb.tabs[1]);
  assert.deepEqual(enviados.at(-1), { tipo: "accion", accion: { nombre: "recargar", pestana: 2, forzar: false } });
  gb.removeTabsToTheEndFrom(gb.tabs[0]);
  assert.deepEqual(enviados.slice(-2).map((m) => m.accion.pestana), [2, 3]);
});

test("el browser de una pestaña cumple el contrato que usa la barra de direcciones", () => {
  const { gb } = montar();
  const b = gb.selectedBrowser;
  assert.equal(b.browserId, 1);
  assert.equal(b.originalURI.spec, "https://p1.com/");
  assert.equal(b.getAttribute("usercontextid"), null, "sin contenedor no hay atributo");
  b.setAttribute("usercontextid", 2);
  assert.equal(b.getAttribute("usercontextid"), "2");
  assert.equal(b.browsingContext.sessionHistory, null, "Rust no tiene historial de sesión que inventar");
  assert.equal(b.browsingContext.sessionHistory?.count === 0, false);
  assert.equal(b.loadContext.usePrivateBrowsing, false);
  b.lastLocationChange = 5;
  assert.equal(b.lastLocationChange, 5);
  let oido = 0;
  b.addEventListener("x", () => oido++);
  b.dispatchEvent(new Event("x"));
  assert.equal(oido, 1);
});

test("el browser carga direcciones y navega por Rust (lo que usa openLinkIn de Firefox)", () => {
  const { gb, enviados } = montar();
  const b = gb.selectedBrowser;
  b.fixupAndLoadURIString("zen browser");
  assert.deepEqual(enviados.at(-1), { tipo: "accion", accion: { nombre: "navegar", pestana: 1, texto: "zen browser" } });
  b.loadURI({ spec: "https://zen.org/" });
  assert.equal(enviados.at(-1).accion.texto, "https://zen.org/");
  b.goBack();
  b.goForward();
  b.reload(0x100);
  assert.deepEqual(enviados.slice(-3).map((m) => [m.accion.nombre, m.accion.forzar ?? null]), [["atras", null], ["adelante", null], ["recargar", true]]);
});
