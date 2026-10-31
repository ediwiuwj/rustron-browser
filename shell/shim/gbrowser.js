// gBrowser (M4): la API de pestañas de Firefox que usa Zen, sobre el estado que Rust
// refleja en el Puente. Cada pestaña de Rust tiene un elemento <tab> y un "browser" mínimo.
//
// Lo que no existe en Rust todavía se queda sin implementar a propósito (la propiedad no
// existe) en vez de simularse: así los fallos son visibles y señalan qué falta en el núcleo.
// Fijar pestañas (pinTab) es hoy solo local: Rust aún no tiene esa acción.

import { nuevaURI } from "./uri.js";

const ETIQUETA_TAB = "tab";

// El "browser" de una pestaña: lo que Zen lee de gBrowser.selectedBrowser y similares.
class NavegadorPestana {
  userTypedValue = null;

  constructor(pestana, datos, principal) {
    this.pestana = pestana;
    this.datos = datos;
    this.principal = principal;
    this.permanentKey = {};
  }

  get currentURI() {
    return nuevaURI(this.datos.uri || "about:blank");
  }
  get documentURI() {
    return this.currentURI;
  }
  get contentTitle() {
    return this.datos.titulo;
  }
  get contentPrincipal() {
    return this.principal(this.currentURI);
  }
  get webNavigation() {
    return { currentURI: this.currentURI };
  }
}

export class GBrowser {
  #puente;
  #crearElemento;
  #principal;
  #contenedor;
  #porId = new Map(); // id de Rust -> <tab>
  #escuchas = new Set();
  #pendientes = []; // pestañas pedidas con addTab que esperan su id de Rust
  #fijadasLocal = new Set();

  // opciones: crearElemento() -> <tab>, contenedor (elemento <tabs>, recibe a las <tab>),
  // principal(uri) -> principal de seguridad.
  constructor(puente, { crearElemento, contenedor, principal }) {
    this.#puente = puente;
    this.#crearElemento = crearElemento;
    this.#contenedor = contenedor;
    this.#principal = principal;
    for (const tipo of ["instantanea", "pestana-creada", "pestana-actualizada", "pestana-cerrada", "espacios", "pestana-activada"]) {
      puente.on(tipo, (mensaje) => this.#alRecibir(mensaje));
    }
    if (puente.listo) {
      this.#sincronizar();
    }
  }

  // --- Predicados (los usa Zen sobre cualquier elemento) ---
  static isTab = (el) => el?.tagName === ETIQUETA_TAB;
  static isTabGroup = (el) => el?.tagName === "tab-group" || el?.tagName === "zen-folder";
  static isTabGroupLabel = (el) => !!el?.classList?.contains("tab-group-label");
  static isSplitViewWrapper = (el) => el?.tagName === "tab-split-view-wrapper";
  isTab = GBrowser.isTab;
  isTabGroup = GBrowser.isTabGroup;
  isTabGroupLabel = GBrowser.isTabGroupLabel;
  isSplitViewWrapper = GBrowser.isSplitViewWrapper;

  // --- Lectura ---
  get tabContainer() {
    return this.#contenedor;
  }

  // Todas las pestañas de la ventana, en el orden de los espacios de Rust.
  get tabs() {
    const orden = this.#puente.espacios.flatMap((e) => e.pestanas);
    return orden.map((id) => this.#porId.get(id)).filter(Boolean);
  }
  get openTabs() {
    return this.tabs;
  }
  get visibleTabs() {
    return this.tabs.filter((t) => !t.hidden);
  }
  get browsers() {
    return this.tabs.map((t) => t.linkedBrowser);
  }
  get pinnedTabCount() {
    return this.tabs.filter((t) => t.pinned).length;
  }
  get _numZenEssentials() {
    return this.tabs.filter((t) => t.hasAttribute("zen-essential")).length;
  }
  get tabGroups() {
    return [];
  }

  get selectedTab() {
    return this.#porId.get(this.#puente.pestanaActiva) ?? null;
  }
  set selectedTab(tab) {
    this.#accionSobre("activar-pestana", tab);
  }
  get selectedTabs() {
    return this.selectedTab ? [this.selectedTab] : [];
  }
  get selectedElements() {
    return this.selectedTabs;
  }
  get selectedBrowser() {
    return this.selectedTab?.linkedBrowser ?? null;
  }
  get currentURI() {
    return this.selectedBrowser?.currentURI ?? nuevaURI("about:blank");
  }
  get contentTitle() {
    return this.selectedBrowser?.contentTitle ?? "";
  }
  get contentPrincipal() {
    return this.selectedBrowser?.contentPrincipal ?? null;
  }

  getTabForBrowser(navegador) {
    return navegador?.pestana ?? null;
  }
  getBrowserForTab(tab) {
    return tab?.linkedBrowser ?? null;
  }
  getAllTabGroups() {
    return [];
  }
  getTabGroupById() {
    return null;
  }

  // --- Escritura: todo pasa por Rust, que es quien manda ---
  addTab(uri = "about:blank", opciones = {}) {
    const tab = this.#nuevoElemento({ id: null, titulo: "", uri, cargando: false, fijada: false, espacio: null });
    this.#pendientes.push({ tab, uri });
    this.#puente.accion("nueva-pestana", { uri, espacio: opciones.zenWorkspaceId ?? undefined });
    return tab;
  }
  addTrustedTab(uri, opciones) {
    return this.addTab(uri, opciones);
  }

  removeTab(tab) {
    this.#accionSobre("cerrar-pestana", tab);
  }
  removeTabs(tabs) {
    tabs.forEach((t) => this.removeTab(t));
  }

  loadURI(uri, { tab = this.selectedTab } = {}) {
    const texto = typeof uri === "string" ? uri : uri.spec;
    if (tab?.rustronId != null) {
      this.#puente.accion("navegar", { pestana: tab.rustronId, texto });
    }
  }

  pinTab(tab) {
    this.#fijadasLocal.add(tab);
    tab.toggleAttribute("pinned", true);
    this.#emitir(tab, "TabPinned");
  }
  unpinTab(tab) {
    this.#fijadasLocal.delete(tab);
    tab.toggleAttribute("pinned", false);
    this.#emitir(tab, "TabUnpinned");
  }

  // Oyentes de progreso (cambios de URL): se avisa con onLocationChange.
  addTabsProgressListener(oyente) {
    this.#escuchas.add(oyente);
  }
  removeTabsProgressListener(oyente) {
    this.#escuchas.delete(oyente);
  }

  addEventListener(...argumentos) {
    this.#contenedor.addEventListener(...argumentos);
  }
  removeEventListener(...argumentos) {
    this.#contenedor.removeEventListener(...argumentos);
  }

  // --- Sincronización con el espejo del Puente ---
  #accionSobre(nombre, tab) {
    if (tab?.rustronId == null) {
      throw new Error(`gBrowser: la pestaña aún no tiene id de Rust (${nombre})`);
    }
    this.#puente.accion(nombre, { pestana: tab.rustronId });
  }

  #nuevoElemento(datos) {
    const tab = this.#crearElemento();
    tab.rustronId = datos.id;
    tab.linkedBrowser = new NavegadorPestana(tab, datos, this.#principal);
    tab.permanentKey = tab.linkedBrowser.permanentKey;
    return tab;
  }

  #aplicar(tab, datos) {
    const anterior = tab.linkedBrowser.datos;
    tab.linkedBrowser.datos = datos;
    tab.rustronId = datos.id;
    tab.setAttribute("label", datos.titulo);
    tab.toggleAttribute("busy", datos.cargando);
    tab.toggleAttribute("pinned", datos.fijada || this.#fijadasLocal.has(tab));
    if (datos.espacio != null) {
      tab.setAttribute("zen-workspace-id", String(datos.espacio));
    }
    return anterior;
  }

  #emitir(tab, tipo, detalle) {
    tab.dispatchEvent(new CustomEvent(tipo, { bubbles: true, detail: detalle }));
  }

  #alRecibir() {
    this.#sincronizar();
  }

  #sincronizar() {
    const vistos = new Set();
    for (const datos of this.#puente.pestanas.values()) {
      vistos.add(datos.id);
      let tab = this.#porId.get(datos.id);
      if (!tab) {
        const pendiente = this.#pendientes.findIndex((p) => p.uri === datos.uri);
        tab = pendiente >= 0 ? this.#pendientes.splice(pendiente, 1)[0].tab : this.#nuevoElemento(datos);
        this.#porId.set(datos.id, tab);
        this.#aplicar(tab, datos);
        this.#contenedor.append(tab);
        this.#emitir(tab, "TabOpen");
      } else if (tab.linkedBrowser.datos !== datos) {
        const anterior = this.#aplicar(tab, datos);
        this.#emitir(tab, "TabAttrModified", { changed: ["label"] });
        if (anterior.uri !== datos.uri) {
          for (const oyente of this.#escuchas) {
            oyente.onLocationChange?.(tab.linkedBrowser, null, null, tab.linkedBrowser.currentURI, 0);
          }
        }
      }
    }
    for (const [id, tab] of [...this.#porId]) {
      if (!vistos.has(id)) {
        this.#porId.delete(id);
        this.#emitir(tab, "TabClose");
        tab.remove();
      }
    }
    const activa = this.selectedTab;
    for (const tab of this.#porId.values()) {
      const seleccionada = tab === activa;
      if (tab.hasAttribute("selected") !== seleccionada) {
        tab.toggleAttribute("selected", seleccionada);
        if (seleccionada) {
          this.#emitir(tab, "TabSelect");
        }
      }
    }
  }
}
