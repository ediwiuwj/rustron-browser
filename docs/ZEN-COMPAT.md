# Capa de compatibilidad Zen sobre WebKit + Rust

Objetivo: que el CSS y el JS reales de Zen (MPL-2.0) corran dentro de un WebView
de WebKitGTK, con las llamadas que Zen le hace a Firefox implementadas por el
backend Rust. Mediciones hechas sobre Zen 1.23.4b (`omni.ja` de la versión x86_64).

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
