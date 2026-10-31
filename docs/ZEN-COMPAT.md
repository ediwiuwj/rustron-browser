# Capa de compatibilidad Zen sobre WebKit + Rust

Objetivo: que el CSS y el JS reales de Zen (MPL-2.0) corran dentro de un WebView
de WebKitGTK, con las llamadas que Zen le hace a Firefox implementadas por el
backend Rust. Mediciones hechas sobre Zen 1.23.4b (`omni.ja` de la versión x86_64).

## Estado actual (resumen; actualizar al cerrar cada avance)

- Hecho: M1 (shim de `Services`/`XPCOMUtils`/`ChromeUtils`/módulos), M2 (puente Rust↔UI con e2e), M3 (emulación
  de XUL con clases reales de Firefox/Zen sobre elementos XUL), M4 en su primer corte (`gBrowser` sobre las
  pestañas de Rust, pestañas encaminadas a los espacios de Zen) y la barra de direcciones real (`UrlbarInput`).
- **El arranque de Zen termina y la barra lateral se ve como la de Zen** (medido con `scripts/probar-zen.sh`, línea
  `ZEN`): `gZenStartup.isReady == true`, `gBrowser.iniciar` ya no falla, la barra mide 186 px (el ancho por defecto de
  Zen), con la barra de direcciones (textos en el idioma del sistema), los botones de arriba y de abajo con sus
  iconos, el espacio y su pestaña. Errores que quedan al arrancar: solo promesas rechazadas por lo que Rust aún no
  tiene (`PlacesUtils.promiseDBConnection`, `BookmarkingUI`, `gUnifiedExtensions`).
- **Conexión a Rust hecha (modo `--zen`)**: `cargo run -p rustron-app -- --zen [url]` abre la interfaz de Zen en un
  WebView con el puente real, y las pestañas web son vistas de WebKit de Rust colocadas encima del área de contenido.
  Verificado de punta a punta con `scripts/probar-app-zen.sh` (abrir, seleccionar, navegar y cerrar pestañas desde la
  interfaz, pasando por `rustron-core`). Ver la sección "Conexión a Rust" al final.
- En modo `--zen` ya funcionan el **bloqueador de anuncios** (misma caché de listas que la app nativa; respeta
  `adblock.enabled`), el **título de la ventana** (el de la pestaña activa) y los **favicons** (WebKit -> `data:` PNG ->
  `EngineEvent::FaviconChanged` -> puente -> atributo `image` de la pestaña), y la vista web tiene las **esquinas
  redondeadas y el margen** de Zen. Todo cubierto por `scripts/probar-app-zen.sh`.
- Siguiente: (1) atajos de teclado con el foco en una pestaña web (hoy solo funcionan con el foco en la interfaz) y
  menús/paneles de la interfaz, que quedarían tapados por la vista de la pestaña; (2) servir la interfaz desde Rust
  (hoy la sirve `scripts/servir-zen.py`, que arranca la app como proceso hijo; lo ideal es portarlo a Rust o a un
  esquema propio) y extraer Zen sin `unzip`; (3) el botón de la biblioteca (`zen-library-button`, widget de
  `createBuiltinWidget`) y el de espacios (`zen-workspaces-button` está, pero sin iconos de espacio) necesitan
  descargas y datos reales; (4) marcadores (Places/SQL) y extensiones: ausentes a propósito; (5) revisar a ojo contra
  Zen real los colores y el tema; (6) las reglas CSS que dependen de una preferencia (`@media -moz-pref`) se resuelven
  al servir con los valores por defecto: no reaccionan a cambios en tiempo de ejecución; (7) decidir si se usa el
  flujo real de `browser-init.js` (ver abajo). Fuera de alcance por ahora: base de lugares, sesión de Firefox,
  contenedores, `<browser>` real.
- Experimentos con `?global` y `?main` en la URL (`RUSTRON_CONSULTA='?global&main' scripts/probar-zen.sh ...`):
  `global-scripts.js` (browser.js, browser-places.js, utilityOverlay...) carga **sin errores**; `browser-main.js`
  (browser-init.js y las escuchas reales de `gBrowserInit`) también carga (con 1 error anidado), pero con él el arranque
  de espacios queda pendiente: de momento no es el camino por defecto.
- Las secciones siguientes son un **diario cronológico**: las cifras (módulos cargados, errores) eran ciertas en su
  momento y las posteriores las reemplazan.

## Tamaño medido

| Pieza | Medida |
|---|---|
| JS de Zen (`zen-components` + `modules/zen`, sin minificados) | ~42.500 líneas, 1,3 MB |
| CSS de Zen (`zen-styles` y skin) | 38 archivos, ~14.300 líneas |
| `browser.xhtml` (esqueleto de la ventana) | 374 KB, 34 hojas de estilo únicas |
| `gBrowser`: miembros distintos usados | 59 |
| `Services`: servicios distintos | 16 (`prefs` 177 usos, `obs` 35, `io` 18) |
| `SessionStore` / `ChromeUtils` | 6 / 4 miembros |
| Módulos de Firefox importados | ~20 (`XPCOMUtils`, `JSONFile`, `Timer`, `PlacesUtils`, `E10SUtils`, `DeferredTask`, `NetUtil`, `AppConstants`...) |

La superficie de llamadas es finita. Lo costoso es el comportamiento: Zen espera
el DOM XUL de Firefox (pestañas como elementos `<tab>` con atributos, `tabbox`,
`tabpanels`, ~114 búsquedas por id) y la cadena de CSS de Firefox (`-moz-*`: 234
usos; `toolbarbutton`: 136; `tabbrowser`: 53; `@media (-moz...)`: 64).

## Etapas

1. **M1 - Núcleo del shim.** `Services.prefs` (con defaults leídos de Zen y
   overrides de `rustron-prefs`), `XPCOMUtils`, `ChromeUtils`, cargador de módulos
   `resource://` y `chrome://`. Se prueba con Node, sin ventana.
2. **M2 - Puente con Rust.** Mensajes entre el WebView de la interfaz y
   `rustron-core`, con eventos de pestañas en ambos sentidos.
3. **M3 - Ventana de Zen.** DOM de `browser.xhtml` adaptado y CSS real; elementos
   XUL emulados como custom elements.
4. **M4 - `gBrowser` y pestañas.** Los 59 miembros usados, sobre pestañas reales.
5. **M5 - Módulos de Zen.** Cargar de a uno: `ZenVerticalTabsManager`,
   `ZenCompactMode`, `ZenSpaceManager` (`gZenWorkspaces`), luego el resto.

## Estado

Herramientas de prueba aisladas (no abren nada en el escritorio real):
- `scripts/captura-webkit.py`: carga una URL en WebKitGTK dentro de una pantalla
  virtual Broadway y guarda un PNG; puede ejecutar un JS de diagnóstico.
- `scripts/prototipo-zen-ui.py`: genera una página con el DOM y el CSS reales de
  Zen. Requirió dos correcciones: quitar el `meta` de Content-Security-Policy de
  Firefox, y poner `xmlns=` antes que `xmlns:*` en la raíz (si no, WebKit
  interrumpe la carga).

Resultado medido: el DOM real de Zen carga en WebKit (1.786 elementos, 39 hojas
de estilo, existen `tabbrowser-tabs`, `navigator-toolbox`, `urlbar`...), pero se
ve como un esqueleto casi vacío: pestañas, workspaces y colores los crea el JS de
Zen al arrancar. Sin la capa de compatibilidad no hay interfaz que mostrar.

- **M1 (en curso):** hecho `Services.prefs` (1.666 defaults reales, ramas,
  observadores, tipos estrictos), `Services.obs`, `XPCOMUtils.defineLazyPreferenceGetter`,
  `ChromeUtils` y el registro de módulos con precarga. 13 pruebas en Node, en CI.
  También hecho: `Services.io.newURI` (nsIURI mínimo), `scriptSecurityManager`, `uuid`,
  `prompt` (con diálogos inyectables), `appinfo`, `wm`, `startup`, `dirsvc` y `focus`.
  Módulos en `shell/shim/modulos/`: `Timer`, `DeferredTask`, `JSONFile` (E/S inyectable),
  `PrivateBrowsingUtils`, `AppConstants` y `NetUtil` (solo `newURI`). 29 pruebas.
  **M1 cerrado**, con dos huecos que dependen del puente de M2: `NetUtil.newChannel` /
  `readInputStream` (red) y el almacenamiento real de `JSONFile` (disco y lz4).
  Zen también usa el global `PathUtils` (`join`, `profileDir`), que aún no existe.
- **M2 (en curso):** puente entre la UI y `rustron-core`.
  - `crates/rustron-bridge` (Rust puro, 12 pruebas): órdenes JSON de la UI -> `Action`;
    cada cambio (de la UI o del motor) se compara con la foto anterior y llega como
    eventos mínimos (`pestana-creada`, `-actualizada`, `-cerrada`, `-activada`,
    `espacios`, `espacio-activado`, `interfaz`). Peticiones con respuesta; `Almacen`
    sirve `leer`/`escribir` confinados a la carpeta del perfil.
  - `shell/shim/puente.js` (7 pruebas): espejo del estado, suscripciones, peticiones
    y `almacenamientoRemoto` para el `JSONFile` del M1.
  - `rustron-engine`: `vista_interfaz` (con su propio `UserContentManager`, para que las
    pestañas no alcancen el puente) y `entregar_a_interfaz`.
  - Probado de punta a punta con un WebKit real: `scripts/probar-puente.sh` (pantalla
    virtual Broadway, no toca el escritorio) carga el `puente.js` verdadero contra el
    `rustron-bridge` verdadero: instantánea, alta de pestaña, evento del motor hacia la
    UI, lectura y escritura de archivos y rechazo de `../`. Ejemplo: `rustron-app/examples/puente_e2e.rs`.
  - Falta: conectar el puente en el binario `rustron-app` (cuando exista la ventana de
    M3) y la red de `NetUtil.newChannel`. El e2e aún no corre en CI (necesita Broadway).
- **M3 (en curso):** la ventana de Zen.
  - Hallazgo: en WebKit los elementos XUL de `browser.xhtml` son `Element` genéricos
    (sin `style`, `hidden`, `dataset`, `click()`), y sus nombres (`tab`, `toolbarbutton`...)
    no admiten `customElements.define` por no llevar guion. Por eso `shell/shim/xul.js` no
    registra clases: **mejora** cada elemento copiándole los miembros de su clase, al crearlo con
    `createXULElement` o al entrar en el documento (MutationObserver). Los selectores CSS de Zen no
    se tocan. Cubre `tabs`/`tab`/`tabbox`/`tabpanels`, popups con sus eventos, `label`/`image`/`value`/
    `checked`, `style` sincronizado con el atributo, `dataset`, `click()`.
  - Medido contra el DOM real de Zen: 1.515 de 1.815 elementos mejorados sin excepciones.
  - Pruebas de DOM: `scripts/probar-webkit.sh` (11 pruebas en WebKit sobre Broadway; Node no
    tiene DOM). No corren en CI todavía.
  - Límites conocidos: los elementos insertados con `innerHTML`/`append` sin `createXULElement` se
    mejoran en una microtarea, no al instante; falta `<browser>` (M4), `focus()` real,
    `arrowscrollbox` con desplazamiento, `panelview` y `menulist`.
  - **Carga del JS real de Zen** (`scripts/probar-zen.sh <browser-omni> <gre-omni>`): `scripts/servir-zen.py`
    sirve la ventana por HTTP en 127.0.0.1 (reescribe `chrome://`, `resource://` y `moz-src://` en CSS,
    en la ventana y en los imports de los módulos) y `shell/shim/arranque.js` define los globales de
    Firefox y ejecuta `zen-sets.js` y `ZenPreloadedScripts.js`, anotando todos los errores en lugar de parar
    en el primero. Resultado actual: 16 módulos de Zen cargan, 7 fallan, y el arranque de Zen aún no termina.
  - Hallazgos que condicionan el diseño:
    1. WebKit **no ejecuta `<script type="module">` en documentos XML** (XHTML); se arranca con `import()`
       dinámico desde un script clásico.
    2. El `importmap` de WebKit 2.54 **no resuelve especificadores de esquema no estándar** en imports
       estáticos (`chrome:`, `resource:`, `moz-src:`): el módulo falla con `Importing a module script failed`
       sin más detalle. Hay que reescribir los especificadores en el servidor (o en el esquema propio de
       Rustron en la app real).
    3. El grafo de imports **estáticos** de los 15 módulos iniciales de Zen es pequeño (29 módulos, solo 6
       de Firefox). Lo grande es lo perezoso (`importESModule` en tiempo de ejecución), que debe precargarse.
  - Siguientes huecos, en el orden en que fallan: global `PathUtils`; `MozXULElement` y
    `MozTabbrowserTabGroup` (base de los custom elements de Zen); `XPCOMUtils.defineLazyServiceGetter`
    (necesita servicios XPCOM); módulos `moz-src:///` citados solo por cadena (`UrlbarPrefs`,
    `ZenLibraryWidget`); `PlacesUtils`. Faltan además los mapas `services-sync` y `devtools`.
- **M4 y M5:** pendientes.

## Licencia

Los archivos de Zen que se adapten conservan su cabecera MPL-2.0. Rustron es
MPL-2.0, así que es compatible. No se versionan los archivos de Zen: se extraen
de una instalación o de la release oficial.

### Avance posterior (PathUtils, MozXULElement)

- Nuevos: `shim/archivos.js` (PathUtils, IOUtils sobre un almacén inyectable; en memoria por ahora),
  `shim/elementos-firefox.js` (MozXULElement con parseXULToFragment, MozTabbrowserTabGroup),
  `ChromeUtils.generateQI`, `XPCOMUtils.defineLazyServiceGetter` perezoso, contrato `app-info`.
- Módulos cargados: 24 (antes 16). `JSONFile` ya tiene almacén; `ZenLibrary` carga.
- Siguientes huecos: `XPCOMUtils.declareLazy` (lo pide UrlbarPrefs), `window.gZenWorkspaces`
  (lo crea el propio arranque de Zen, falla en `ZenLibrary`), `PlacesUtils.sys.mjs`.

### Avance: declareLazy y gZenWorkspaces

- `XPCOMUtils.defineLazy/declareLazy`, `Cu.getWeakReference`, `window.docShell.treeOwner` (ventana con
  barras, para `shouldHaveWorkspaces`), globales perezosos `PrivateBrowsingUtils` y `AppConstants`,
  stub de Nimbus (`modulos/ExperimentAPI.sys.mjs`, también en `resource://nimbus/`).
- `ZenSpaceManager.mjs` se evalúa antes que `ZenLibrary` (crea `window.gZenWorkspaces`, que
  `ZenLibrary` usa al definirse). Módulos cargados: 48.
- Bloqueo actual: `ZenLibraryDragAndDrop` hace `extends window.ZenDragAndDrop`, que a su vez extiende
  `window.TabDragAndDrop` (código de pestañas de Firefox) → depende de M4 (gBrowser/tabs).
  Queda también `PlacesUtils.sys.mjs` y un "superclass is not a constructor" en `ZenPreloadedScripts.js`
  (por localizar).

### M4 (primer corte): gBrowser

- `shim/gbrowser.js`: `GBrowser` sobre el espejo del Puente. Un `<tab>` y un "browser" mínimo
  (`currentURI`, `contentTitle`, `contentPrincipal`...) por pestaña de Rust; emite `TabOpen`,
  `TabSelect`, `TabClose`, `TabAttrModified`; `addTabsProgressListener` recibe `onLocationChange`.
  Las acciones (`removeTab`, `selectedTab =`, `loadURI`, `addTab`) salen hacia Rust y la UI cambia
  solo cuando Rust responde. `addTab` devuelve ya el elemento y lo adopta al llegar `pestana-creada`
  (se empareja por URI exacta: si Rust normaliza la URI, habrá que emparejar por otro dato).
- Por decisión, lo que Rust no tiene aún **no existe** en `GBrowser` (moveTabTo, grupos, split view,
  duplicar...). `pinTab`/`unpinTab` son solo locales: falta la acción en el núcleo.
- Sustitutos de Firefox servidos por `servir-zen.py` (`SUSTITUTOS`): `Tabbrowser.sys.mjs`
  (predicados, prefs, `closingTabsEnum`) y `SessionStore.sys.mjs` (solo `promiseInitialized` y
  `promiseAllWindowsRestored`).
- `arranque.js`: carga `tabbrowser/drag-and-drop.js` antes que los scripts de Zen (como browser-main.js),
  simula `customElements.setElementCreationCallback` (llamada inmediata), `delayedStartupPromise`
  y dispara un `DOMContentLoaded` sintético tras los scripts. `ZenLibrary` y su sección Spaces se
  evalúan al final porque extienden `window.ZenDragAndDrop`.
- Resultado: `ZenPreloadedScripts.js` se ejecuta entero, 84 módulos ok, 0 fallos de módulo, los
  `init` de Zen en DOMContentLoaded corren. Único error: `PlacesUtils.sys.mjs`.
- La captura sigue mostrando solo el esqueleto: falta `<browser>`, el CSS de pestañas verticales
  y los módulos de M5 (ZenVerticalTabsManager...) activándose de verdad.

### PlacesUtils (stub) y el siguiente límite real

- `shim/modulos/PlacesUtils.sys.mjs`: solo constantes (`bookmarks.TYPE_*`, `history.TRANSITIONS`, de
  memoria las de transición), `toPRTime`/`toDate` y el favicon por defecto. Con él se precargan 88 módulos.
- Lo que queda es real, no un hueco de stub: `ZenSpaceBookmarksStorage.js` ejecuta SQL contra la base
  de lugares (`promiseDBConnection`, `withConnectionWrapper`, tabla `zen_bookmarks_workspaces`).
  Necesita un servicio de base de datos en Rust (SQLite) detrás del puente; simularlo en JS sería
  inventar un SQL que no existe. Lo mismo vale para historial (`history.insertMany`, `executeQuery`)
  y favicons.

### Por qué no se pintan las pestañas (investigación)

Medido en WebKit con `gBrowser.tabs.length == 1`: el `<tab>` existe, está en `#tabbrowser-tabs` y es
visible, pero mide 28×515 y no tiene hijos. Causas:

1. **Falta el contenido del `<tab>`.** En Firefox lo crea la clase `MozTabbrowserTab` (`tabbrowser/tab.mjs`:
   `static markup` con `.tab-stack`, `.tab-background`, `.tab-content`, `.tab-label`...) al conectarse.
   `browser-main.js` la carga y la registra como `customElements.define("tabbrowser-tab", ..., {extends: "tab"})`.
   Nosotros no ejecutamos `browser-main.js`, y WebKit no admite ni `extends` sobre XUL ni custom
   elements en el espacio de nombres XUL. Lo mismo vale para `tabs.mjs` (`tabbrowser-tabs`, con su
   `arrowScrollbox`), `tabgroup.mjs`, `tabsplitview.mjs`.
2. **El `<tab>` se añade al sitio equivocado**: `GBrowser` hace `contenedor.append(tab)`; Firefox lo
   coloca dentro de `#tabbrowser-arrowscrollbox` (que aquí mide 0 de ancho), y Zen reparte las pestañas
   entre sus contenedores de espacio (`zen-workspace`, pinned...). No hay ningún `zen-workspace` en el DOM.
3. Los `init` de Zen corren, pero sobre `gBrowser.tabs` con elementos pelados.

**Vía técnica comprobada** (sonda en WebKit): se puede dar a un elemento XUL ya creado una clase real de
Firefox/Zen con el truco del constructor que devuelve un objeto: `MozXULElement` extiende `HTMLElement`
pero su constructor, si hay un elemento pendiente, lo **devuelve** sin llamar a `super()`; antes se hace
`Object.setPrototypeOf(el, Clase.prototype)` y `new Clase()`. Resultado: `new Clase() === el`, los campos
y métodos privados (`#x`) de la clase quedan instalados en el elemento y `instanceof` funciona.
Efecto secundario: los accesores de `HTMLElement.prototype` fallan con "can only be used on instances of
HTMLElement" (`title`, `lang`, `innerText`, `draggable`, `offsetWidth`, `contentEditable`...), porque el
elemento XUL no es un HTMLElement; hay que sombrearlos con propiedades propias (reflejo de atributos / rect).
`style`, `dataset`, `hidden`, `click` ya los cubre xul.js.

**Plan:** (a) `xul.js` pasa a "envolver" con clases reales (mismo mecanismo para `tab`, `tabbrowser-tabs`,
`tab-group`, `zen-folder`...); (b) cargar `tab.mjs`, `tabs.mjs`, `tabgroup.mjs` como lo hace `browser-main.js`
(`MozElements.MozTab` y compañía vienen de toolkit `customElements.js`, aún sin precargar); (c) que `GBrowser`
inserte cada `<tab>` donde Firefox/Zen lo espera.

### Clases reales sobre elementos XUL (paso a del plan)

- `xul.js`: `XULElement` (hereda de HTMLElement; su constructor devuelve el elemento pendiente), registro
  interceptado en `customElements.define/get` (admite `extends` y `createXULElement(nombre, {is})`),
  `envolver`/`reenvolver` (prototipo + `new Clase()`), ciclo de vida (`connectedCallback`,
  `disconnectedCallback`, `attributeChangedCallback` en microtarea) y sombras de los accesores de
  `HTMLElement`. Lo nativo de XUL (hidden, style, dataset...) vive ahora en `XULElement.prototype`, así
  que los miembros de la clase real lo pisan.
- 17 pruebas en WebKit (6 nuevas). `MozXULElement` (elementos-firefox.js) extiende `XULElement`.
- Efecto en el arranque: Zen ya construye sus clases sobre los elementos; falla `ZenSpaceIcons.mjs` por
  `this.delayConnectedCallback is not a function`, es decir, falta la base real de toolkit (paso b):
  `customElements.js` (`MozElements.MozElementMixin`: `delayConnectedCallback`, `isConnectedAndReady`,
  `initializeAttributeInheritance`, `fragment`...), `MozElements.MozTab` y compañía.

### Paso b: la base real de toolkit y los elementos de pestañas

- `arranque.js` carga el `customElements.js` real (MozXULElement, MozElements y los elementos de toolkit
  que carga de inmediato) y después `tab.mjs`, `tabgroup.mjs`, `tabs.mjs`, `tabsplitview.mjs` (como
  `browser-main.js`). Con eso desaparecen los fallos de `MozXULElement`/`MozTabbrowserTabGroup`
  (ZenFolder, ZenSpace, ZenSpaceCreation, ZenSpaceIcons) y cargan 161 módulos; el `<tab>` de `gBrowser`
  ya se construye como `tabbrowser-tab` (con `aria-level`, `context`, su `.tab-stack`).
- **Shadow DOM en elementos XUL: no se puede en WebKit** (`attachShadow` → "The operation is not
  supported"). Se omiten los scripts de toolkit que lo usan (`arrowscrollbox`, `dialog`, `menupopup`,
  `panel`, `autocomplete-popup`, `tree`, `wizard`, `menulist`; lista `OMITIDOS` en arranque.js) y
  `arrowscrollbox` tiene sustituto propio sin shadow (`shim/arrowscrollbox.js`: el elemento es su
  propia `scrollbox`, sin botones de flecha, con `overflow`/`underflow`). Los popups siguen con la
  emulación de xul.js. Emular shadow DOM con `<slot>` en XUL se descartó: obliga a mover los hijos y
  rompe `arrowScrollbox.children`, que tabs.mjs usa.
- `xul.js` ahora: bases nativas (`XULPopupElement`, `XULMenuElement`, `XULTextElement`,
  `XULTreeElement`, `XULLabeledControlElement`), inserción y eliminación síncronas (`append`,
  `insertBefore`, `remove`... mejoran y conectan al instante; el observador queda de red de seguridad),
  `cloneNode`/`importNode` que mejoran la copia, `setElementCreationCallback` diferido (se cumple con el
  primer elemento; un fallo se informa sin interrumpir) y regla `is`: un elemento con `is` espera a la
  clase de ese nombre y no se envuelve con la de su etiqueta (los métodos privados solo se instalan una vez).
- Globales de apoyo: `MozQueryInterface`, `Services.env`, `document.commandDispatcher`, `ChromeNodeList`,
  `DOMParser.parseFromSafeString/forceEnableXULXBL`, `Element.moveBefore`, y las prefs de plataforma
  `ui.key.menuAccessKey/accelKey`.
- Quedan fuera a propósito: `<browser>` (M4 real; el callback de creación se omite) y los módulos
  `moz-*` de acorn, que usan `import ... with { type: "css" }` (WebKit 2.54 no lo admite: fallan y
  Firefox-style definen un elemento vacío).
- Sigue sin verse nada: falta el paso c (que `GBrowser` inserte los `<tab>` en
  `#tabbrowser-arrowscrollbox`/contenedores de espacio de Zen) y que los módulos de M5 se activen.

### Paso c: las pestañas ya van a donde Zen las espera (medido)

- `GBrowser` inserta con `tabContainer.appendChild` (lo encamina `tabs.mjs`/Zen), adopta el `<tab>` que trae
  `browser.xhtml` como pestaña inicial (como `Tabbrowser.#setupInitialBrowserAndTab`), se crea **después** de
  definir `tabbrowser-tab` (el constructor de la clase reinicia `linkedBrowser`) y `iniciar(documento)` hace
  lo que `Tabbrowser.init` (localiza `pinned-tabs-container`, `tabbox`... e inicia `tabContainer`).
- Los espacios de Rust llegan a Zen con `shim/sesion-zen.js` (`restoreWorkspacesFromSessionStore` +
  `onWindowRestored`, lo que en Firefox hace el gestor de sesión); UUID de espacio = `{00000000-0000-4000-8000-<id>}`.
- Se lanza `MozBeforeInitialXULLayout` (arranca `gZenStartup.init`).
- Resultado medido: existe un `zen-workspace`, el `<tab>` está dentro de su `vbox`, con clase
  `tabbrowser-tab`, etiqueta "New Tab", `zen-workspace-id` y tamaño real (76×36). **Todavía no se ve**: el
  arranque de Zen no termina (`gZenStartup.isReady == false`, `zen-before-loaded` sigue puesto, así que el
  "watermark" deja `opacity: 0` en `#browser > *`; la barra lateral mide 60 px).
- `shim/marcadores-zen.js`: la asociación marcadores↔espacio está vacía (sin marcadores ni base de lugares);
  las lecturas devuelven lo mismo que las consultas SQL sin filas; las escrituras no existen.
- Globales de ventana añadidos (stubs mínimos): `CustomizableUI`, `DynamicShortcutTooltip`, `gNavToolbox`,
  `gURLBar` (el elemento, sin la lógica de `UrlbarInput`), `windowUtils`, `gMultiProcessBrowser=false`,
  `FirefoxViewHandler`, `gClickAndHoldListenersOnElement`, `HandleAppCommandEvent`, `Element.documentGlobal`;
  `gBrowser.TabMetrics/tabLocalization/TabStateFlusher`. Contenedores desactivados (`privacy.userContext.enabled=false`).
- Falta para terminar el arranque (errores aún registrados): `gZenCompactModeManager`/`gZenVerticalTabsManager`
  (fallan por `UrlbarInput`: `gURLBar.zenFormatURLValue`), `ZenHasPolyfill`, `Downloads`, el tema
  (`ZenGradientGenerator`), `PlacesUtils.promiseDBConnection` en otros usos. El grueso es la barra de
  direcciones real (`UrlbarInput.mjs`), que es M5.

### Barra de direcciones: se usa el `UrlbarInput` real de Zen

`UrlbarInput.mjs` de Zen son 12 líneas sobre `UrlbarInputBase.mjs` (7 080 líneas, ya con los retoques de Zen,
p. ej. `zenFormatURLValue`), así que se carga el real en lugar de inventar un `gURLBar`:
- Carga con 396 módulos (antes 181): el lado "cliente" (`chrome://browser/content/urlbar/`) y el "padre"
  (`moz-src:///browser/components/urlbar/`: `UrlbarParentController`, `UrlbarProvidersManager` y proveedores).
  En una ventana de Firefox el controlador padre corre en el mismo proceso: `windowGlobalChild.getActor("Urlbar")`
  es un objeto local con `browsingContext.topChromeWindow = window`.
- **Arreglo de fondo en la precarga**: `dependenciasDe`/`citadosEn` leían el texto *ya reescrito* por el servidor
  (sin esquemas `chrome:`/`moz-src:`), así que los imports estáticos nunca llegaban a la caché del registro y
  `importESModule` síncrono fallaba para ellos. Ahora se lee el original (`?crudo`).
- Sustitutos/stubs nuevos: `SearchService.sys.mjs` (un único motor: el de la configuración de Rust,
  `general.search_engine`; `usarBuscador` lo fija), `Services.urlFormatter`, `Glean` (todo vacío: sin telemetría),
  `PlacesObservers`, `PlacesWeakCallbackWrapper`, `webrtcUI`, `Components.Constructor`, `defineLazyServiceGetters`,
  prefs de `Services.prefs` utilizables sin `this` (Firefox extrae los métodos).
- Servidor: parche genérico que quita la "autoimportación" (`ChromeUtils.importESModule` de sí mismo bajo `urlbar/`);
  un módulo no puede importarse a sí mismo mientras se evalúa.
- Estado: sin sugerencias (no hay proveedores con datos: ni Places ni historial). Quedan errores registrados:
  pref `quickSuggestOnlineAvailable` (UrlbarPrefs/Nimbus), `ZenThemeModifier`, `BookmarkingUI`, el tema
  (`ZenGradientGenerator`), `gZenWorkspaces.workspaceIcons` en `tabs.mjs`. `UrlbarProviderOpenTabs` falla por
  un ciclo de imports y `UrlbarParent.sys.mjs` (actor) se omite.

### Arranque de Zen: lo que hizo falta para que terminara

- `loadSubScript` con destino `window` ejecuta el script como un `<script>` clásico: así `let`/`const`/`class` de nivel
  superior son visibles para los scripts siguientes (con `eval` indirecto cada script tenía su ámbito léxico). Los errores
  de un `<script>` se recogen del evento `error` y se asignan al script más interno en curso.
- Un script que falla dentro de otro (anidado) se anota y no interrumpe a quien lo cargó.
- `Ci.nsIFoo` son funciones (el código hace `instanceof Ci.nsIFoo`); `docShell.QueryInterface`, `useRemoteTabs` y
  `rollupAllPopups` existen. `AppConstants.MOZILLA_OFFICIAL = true`.
- Módulos de Firefox sustituidos por los propios en `shell/shim/modulos/` (declarados en `SUSTITUTOS` de
  `servir-zen.py`): `Tabbrowser`, `SessionStore`, `TabStateFlusher`, `SearchService`, `CustomizableUI`, `Downloads`,
  `webrtcUI`, `AIWindow`, `ExperimentAPI` (Nimbus, con el manifiesto de `urlbar`), `PlacesUtils`.
- Stubs de globales de ventana: `document.l10n` (guarda id y argumentos, sin Fluent), `Services.strings`, `Glean`,
  `windowUtils`, `gMultiProcessBrowser`...; `XPCOMUtils.defineLazyScriptGetter`/`defineConstant`.
- CSS: los popups (`menupopup`, `panel`, `tooltip`) se ocultan salvo `state="open"` (en Firefox son ventanas aparte);
  sin esto los menús contextuales de Zen aparecían apilados en la esquina.
- `?crudo` en `servir-zen.py`: texto sin reescribir (para leer imports); `PARCHES` generales quitan la
  autoimportación de los módulos de `urlbar/`.

### La barra lateral se ve: lo que fallaba y no era evidente

Medido en WebKit con sondas (`captura-webkit.py` + JS que lee geometría y estilos calculados):

- **El atributo `style` de un elemento XUL no se aplica en WebKit.** Solo lo respetan los elementos de HTML, SVG y
  MathML; los XUL son `Element` genéricos. Zen escribe estilos en línea todo el rato (`toolbox.style.width = ...`,
  `--zen-sidebar-width`), así que la barra lateral salía de 424 px y toda la disposición cambiaba. Solución
  (`xul.js`, "Estilos en línea"): cada elemento XUL con `style` recibe una regla CSS propia en una hoja generada
  (`[rustron-estilo="N"]` con cuatro `:not(#_)` de especificidad, `!important` respetado); se sincroniza al escribir
  `.style`, al llamar a `setAttribute("style")` y al entrar elementos con `style` en el marcado; los clones no
  heredan la regla del original. Cubierto por dos pruebas de WebKit.
- **Más de 360 reglas de Zen cuelgan de `@media -moz-pref(...)`/`(-moz-platform: ...)`**, que en WebKit son consultas
  inválidas y el motor descarta el bloque entero. `servir-zen.py` las resuelve al servir (preferencias por defecto,
  plataforma Linux). También `-moz-available` -> `-webkit-fill-available`.
- **Los iconos de XUL (`list-style-image` sobre `<image>`, SVG con `context-fill`) no pintan en WebKit.** El servidor
  acompaña cada declaración con variables (`--rustron-icono`/`--rustron-imagen`, con la URL ya absoluta: en una
  variable la URL relativa se resuelve contra la hoja que la usa) y `compat-xul.css` las pinta en un `::before` del
  `<image>` (máscara teñida con el color del texto; Zen fuerza `background: transparent !important` en algunos `<image>`).
- `compat-xul.css` ponía `align-items: center` en `toolbar`/`toolbaritem`: encogía las pestañas a 28 px. Las barras
  XUL estiran a sus hijos.
- `MozBeforeInitialXULLayout` se lanza **en el documento y con burbujeo** (Zen escucha en `document` y en `window`) y
  **antes** de `gBrowser.iniciar`; si no, `ZenCompactMode.preInit` no corre y la ventana arranca en modo compacto, y
  `workspaceIcons` no existe cuando `ZenDragAndDrop.init` lo pide. `UrlbarInput` se define después de los scripts de Zen
  (al definirse se conecta y pide `gZenVerticalTabsManager`).
- `CustomizableUI` mínimo (`modulos/CustomizableUI.sys.mjs`): `iniciarVentana` hace lo que `CustomizableUIInternal` al
  abrir la ventana: `ZenCustomizableUI.startup/init/registerToolbarNodes` (separador, botones superiores, barra
  inferior) y marca los widgets con `cui-areatype`.
- **Localización**: `shim/fluent.js` es un intérprete de Fluent propio (Firefox usa fluent-rs; no hay versión en JS):
  12.869 mensajes de Zen y Firefox analizados, 1 fallo (`platform()` en minúscula). `shim/l10n.js` da
  `document.l10n`, `DOMLocalization` y `Localization` encima; traduce al instante en `setAttributes`.
  `servir-zen.py` sirve los `.ftl` en `/l10n/<idioma>/<ruta>`; idiomas: los del sistema y, al final, `en-US`.
- `import ... with { type: "css" }`: el servidor sirve la hoja como un módulo JS que exporta un `CSSStyleSheet`
  (`?hoja`) y quita el atributo; los `moz-*` de acorn ya cargan.
- Otros huecos de la ventana: `requestIdleCallback`, `promiseDocumentFlushed`, `InspectorUtils.colorToRGBA`,
  `controllers` de los campos de texto, `Cu.isESModuleLoaded`, `gBrowser.showTab/hideTab/warmupTab`, `ctrlTab` real,
  `ConfigSearchEngine` vacío, el tema del espacio (`nsZenThemePicker.getTheme`).
- Herramientas: `RUSTRON_REGISTRO=1` en `servir-zen.py` imprime los 404; `console.error` de Zen se anota con su mensaje.

### Conexión a Rust (modo `--zen`)

`crates/rustron-app/src/zen.rs`. `rustron-app --zen [url]`:

1. **Zen**: `RUSTRON_ZEN` (por defecto `/opt/zen-browser-bin`). Se extrae una **copia** de sus `omni.ja` a
   `~/.local/share/rustron/zen/{browser,gre}` (solo si cambió el archivo; `unzip` sale con 1 o 2 por los datos extra al
   principio del ZIP aunque extrae todo, así que se acepta 0..=2 y se comprueba que exista `chrome/`). Nunca se ejecuta.
2. **Servidor**: arranca `scripts/servir-zen.py` (o `RUSTRON_SERVIDOR`) como proceso hijo en un puerto libre de 127.0.0.1;
   se detiene al cerrar la ventana y al salir.
3. **Interfaz**: un WebView con su propio `UserContentManager` (manejador `rustron`) carga `/ui.xhtml`. Solo puede
   navegar al servidor local (`decide-policy`): ninguna página web alcanza el puente.
4. **Puente**: `arranque.js` detecta `window.webkit.messageHandlers.rustron` y usa el `Puente` real
   (`conectar()` -> instantánea); sin él usa el puente local de una pestaña (diagnóstico con `probar-zen.sh`).
   `rustron-bridge` procesa las órdenes; los efectos (`Navigate`, `Reload`, `Release`...) los aplica la app, y lo que el
   motor reporta (título, URL, carga) entra de vuelta por el puente. Las notificaciones de WebKit se difieren al bucle
   principal (`idle_add`) para no tomar prestadas las `RefCell` dentro de `load_uri`.
5. **Pestañas web**: una vista por pestaña de `rustron-core`, en un `gtk::Stack` dentro de un `gtk::Overlay` sobre la
   interfaz. La interfaz avisa del rectángulo de `#tabbrowser-tabpanels` con `{tipo:"area-contenido",x,y,ancho,alto}`
   (ResizeObserver) y Rust coloca el `Stack` con márgenes y tamaño.
6. **Configuración**: la petición `config` devuelve `general.search_engine` y `general.homepage`; `arranque.js` pasa el
   buscador a `SearchService`. El resto de peticiones (`leer`/`escribir`) van al `Almacen` confinado a `.../rustron/perfil`.

Lo que costó, medido con `RUSTRON_SONDA=archivo.js` (JS que se evalúa en la interfaz al capturar; varios separados por
`//---` se evalúan en orden con 3 s de pausa) y `RUSTRON_CAPTURA=ruta.png` (guarda la ventana entera y sale):

- `tabs.mjs init()` pone «New Tab» a la primera pestaña (en Firefox acaba de nacer): `GBrowser.iniciar` vuelve a aplicar
  los datos de Rust después.
- Zen crea una **pestaña vacía** (`addTab` con `_forZenEmptyTab`) como marcador del espacio sin pestañas: es local a la
  interfaz (`GBrowser`), no existe en Rust, y se puede seleccionar sin tocar a Rust; cuando Rust activa una pestaña, manda Rust.
- Las pestañas nuevas llevan la clase `tabbrowser-tab` (el CSS de Zen que oculta la vacía cuelga de ella) y `TabSelect`
  lleva `detail.previousTab`.
- `:not(:-moz-native-anonymous)` y otras pseudoclases `-moz-` invalidaban reglas enteras (entre ellas la que superpone los
  hijos de `<stack>`: las pestañas medían 64 px en lugar de 40). El servidor las reescribe.
- Los mensajes que Rust entrega antes de que cargue la interfaz se pierden (`__rustronRecibir` aún no existe); no importa
  porque `listo` pide la instantánea completa al conectar.

### Bloqueador, título, favicons y esquinas (modo `--zen`)

- **Bloqueador**: `bloqueador.rs` (descarga/lee las listas y las compila en un hilo) lo comparten la app nativa y `--zen`.
  La prueba usa listas locales con la regla `/anuncio.js$script` y una página que intenta cargarlo: si no se bloquea, su
  título pasa a «Segunda (anuncio)». (La primera versión de la prueba usaba `||127.0.0.1^*/anuncio.js`, que
  `adblock-rust` convierte a una expresión con un `^` literal y no bloquea nada: el fallo era de la regla, no del motor.)
- **Favicon**: `Tab.icon` y `EngineEvent::FaviconChanged` en el núcleo, `icono` en `PestanaDto`; la app convierte la
  textura de WebKit a PNG (`gdk::Texture::save_to_png_bytes`, requiere la feature `v4_6` de gtk4) y la codifica en base64
  (función propia con los vectores de la RFC 4648 como prueba). `GBrowser` pone/quita `image` y el `src` del `<img>`.
- **Esquinas redondeadas**: Zen redondea (y da sombra a) un `.browserSidebarContainer` por pestaña, que aquí no existe
  porque no hay `<browser>`. La interfaz crea uno (`#rustron-contenido`) que hace de hueco, mide su rectángulo y su
  `border-radius` y los envía en `area-contenido`; Rust redondea la pila (`overflow` oculto + CSS dinámico). La sombra
  la pinta la propia interfaz, debajo.
- Colocar la pila con `width_request`/márgenes no bastaba: son mínimos y la vista web desbordaba hasta el borde de la ventana. Se
  usa `Overlay::connect_get_child_position` con el rectángulo exacto.
