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
  // El foco del contenido web llegará con la vista de la pestaña (WebKit); por ahora no hace nada.
  focus() {}
}

export class GBrowser {
  #puente;
  #crearElemento;
  #principal;
  #contenedor;
  #porId = new Map(); // id de Rust -> <tab>
  #escuchas = new Set();
  // La "pestaña vacía" de Zen (`_forZenEmptyTab`) es un marcador de la interfaz para el espacio sin
  // pestañas, no una página: no existe en Rust, solo aquí.
  #vacias = new Set();
  #activaVacia = null;
  #ultimaActivaRust = null;
  #pendientes = []; // pestañas pedidas con addTab que esperan su id de Rust
  #fijadasLocal = new Set();
  #idEspacio;
  #tabsDeMarcado;

  // opciones: crearElemento() -> <tab>, contenedor (elemento <tabs>, recibe a las <tab>),
  // principal(uri) -> principal de seguridad, idEspacio(id de Rust) -> valor de `zen-workspace-id`.
  // tabsDeMarcado: <tab> que ya trae el documento; se reparten a las primeras pestañas de Rust
  // (Firefox adopta así su pestaña inicial en lugar de crear otra).
  constructor(puente, { crearElemento, contenedor, principal, idEspacio = String, tabsDeMarcado = [] }) {
    this.#idEspacio = idEspacio;
    this.#tabsDeMarcado = [...tabsDeMarcado];
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

  // Lo que Tabbrowser.init hace con el documento: localiza los elementos de la barra de pestañas e
  // inicia el contenedor (tabs.mjs lee de aquí `pinnedTabsContainer`, `arrowScrollbox`...).
  iniciar(documento) {
    this.document = documento;
    this.ownerDocument = documento;
    this.documentGlobal = documento.defaultView;
    this.ownerGlobal = documento.defaultView;
    this.tabGroupMenu = documento.getElementById("tab-group-editor");
    this.tabNoteMenu = documento.getElementById("tab-note-menu");
    this.tabbox = documento.getElementById("tabbrowser-tabbox");
    this.tabpanels = documento.getElementById("tabbrowser-tabpanels");
    this.pinnedTabsContainer = documento.getElementById("pinned-tabs-container");
    this.splitViewCommandSet = documento.getElementById("splitViewCommands");
    this.#contenedor.init?.();
    // tabs.init() pone el título vacío ("New Tab") a la primera pestaña, que en Firefox acaba de nacer;
    // aquí ya tiene el título que dio Rust, así que se vuelven a aplicar los datos de Rust.
    for (const tab of this.#porId.values()) {
      this.#aplicar(tab, tab.linkedBrowser.datos);
    }
  }

  // --- Lectura ---
  get tabContainer() {
    return this.#contenedor;
  }

  // Todas las pestañas de la ventana, en el orden de los espacios de Rust.
  get tabs() {
    const orden = this.#puente.espacios.flatMap((e) => e.pestanas);
    return [...orden.map((id) => this.#porId.get(id)).filter(Boolean), ...this.#vacias];
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

  // Mostrar y ocultar una pestaña es el atributo `hidden` y su evento, como en Firefox (sin la parte
  // de SessionStore, que guarda quién la ocultó: eso lo lleva Rust).
  showTab(tab) {
    if (tab.hidden) {
      tab.removeAttribute("hidden");
      tab.dispatchEvent(new Event("TabShow", { bubbles: true }));
    }
  }
  hideTab(tab) {
    if (!tab.hidden && !tab.pinned && !tab.selected) {
      tab.setAttribute("hidden", "true");
      tab.dispatchEvent(new Event("TabHide", { bubbles: true }));
    }
  }

  // Firefox adelanta así el proceso de contenido de la pestaña que va a mostrar. Aquí no hay procesos
  // que adelantar (la página la carga el motor de Rust al activarla), así que no hace nada.
  warmupTab() {}

  get selectedTab() {
    return this.#activaVacia ?? this.#porId.get(this.#puente.pestanaActiva) ?? null;
  }
  set selectedTab(tab) {
    if (this.#vacias.has(tab)) {
      const anterior = this.selectedTab;
      anterior?.removeAttribute("selected");
      this.#activaVacia?.removeAttribute("selected");
      this.#activaVacia = tab;
      tab.setAttribute("selected", "true");
      this.#emitir(tab, "TabSelect", { previousTab: anterior });
      return;
    }
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
    if (opciones._forZenEmptyTab) {
      const tab = this.#nuevoElemento({ id: null, titulo: "", uri: "about:blank", cargando: false, fijada: false, espacio: null }, false);
      this.#vacias.add(tab);
      tab.setAttribute("zen-empty-tab", "true");
      this.#contenedor.appendChild(tab);
      this.#emitir(tab, "TabOpen");
      return tab;
    }
    const tab = this.#nuevoElemento({ id: null, titulo: "", uri, cargando: false, fijada: false, espacio: null }, false);
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

  #nuevoElemento(datos, adoptar = true) {
    const tab = (adoptar && this.#tabsDeMarcado.shift()) || this.#crearElemento();
    tab.rustronId = datos.id;
    tab.linkedBrowser = new NavegadorPestana(tab, datos, this.#principal);
    if (!("permanentKey" in tab)) {
      tab.permanentKey = tab.linkedBrowser.permanentKey; // la clase real de Firefox ya lo define
    }
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
      tab.setAttribute("zen-workspace-id", this.#idEspacio(datos.espacio));
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
        if (!tab.isConnected) {
          this.#contenedor.appendChild(tab); // tabs.mjs (y Zen) lo encaminan a la sección del espacio
        }
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
    if (this.#puente.pestanaActiva !== this.#ultimaActivaRust) {
      // Rust activó una pestaña: la de verdad vuelve a mandar sobre el marcador vacío.
      this.#ultimaActivaRust = this.#puente.pestanaActiva;
      this.#activaVacia?.removeAttribute("selected");
      this.#activaVacia = null;
    }
    const activa = this.selectedTab;
    // La pestaña que dejó de estar seleccionada: TabSelect la lleva en `detail.previousTab`.
    const anterior = [...this.#porId.values()].find((t) => t !== activa && t.hasAttribute("selected")) ?? null;
    for (const tab of this.#porId.values()) {
      const seleccionada = tab === activa;
      if (tab.hasAttribute("selected") !== seleccionada) {
        tab.toggleAttribute("selected", seleccionada);
        if (seleccionada) {
          this.#emitir(tab, "TabSelect", { previousTab: anterior });
        }
      }
    }
  }
}
