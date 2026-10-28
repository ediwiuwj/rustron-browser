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

- Medición completada; `scripts/prototipo-zen-ui.py` genera una página con el DOM
  y el CSS reales de Zen (XML bien formado). **Sin verificar visualmente todavía.**
- M1 a M5: pendientes.

## Licencia

Los archivos de Zen que se adapten conservan su cabecera MPL-2.0. Rustron es
MPL-2.0, así que es compatible. No se versionan los archivos de Zen: se extraen
de una instalación o de la release oficial.
