# AGENTS.md — guía para IAs y colaboradores

Rustron: navegador ligero para Linux (Wayland/Hyprland) en Rust, WebKitGTK 6.0 + GTK4, con la interfaz
de Zen. Idioma del proyecto: **español** (código, comentarios, commits, docs). Responde en español.

## Dónde está cada cosa

- `crates/` — Rust. `rustron-store` guarda historial y sesión (con migraciones). `rustron-core` (modelo, sin GTK) y `rustron-bridge` (puente JSON UI↔core) son puros y
  baratos de compilar y probar. `rustron-engine` es el **único** que usa `webkit6`. `rustron-app` es el binario GTK.
- `shell/shim/` — la capa de compatibilidad Zen en JavaScript (módulos ES). Punto de entrada: `arranque.js`. `fluent.js`/`l10n.js`: localización.
- `shell/tests/*.test.js` — pruebas en Node (sin DOM). `shell/webtests/*.webtest.js` — pruebas de DOM, se
  ejecutan dentro de WebKit con `scripts/probar-webkit.sh`.
- `scripts/` — `servir-zen.py` (sirve la ventana de Zen a WebKit), `probar-zen.sh` (arranque de Zen y errores),
  `captura-webkit.py` (URL -> PNG en pantalla virtual Broadway), `probar-puente.sh` (e2e con WebKit real).
- `crates/rustron-app/src/zen.rs` — modo predeterminado de la app (interfaz de Zen conectada al puente real); `RUSTRON_SONDA`/`RUSTRON_CAPTURA` para depurar.
- `docs/ZEN-COMPAT.md` — **lee esto antes de tocar `shell/`**: etapas M1–M5, hallazgos de WebKit y estado exacto.
  `docs/PLAN.html` — plan general.

## La idea de la capa Zen (resumen)

El JS y el CSS reales de Zen (MPL-2.0) corren en un WebView. Lo que Zen espera de Firefox (`Services`,
`ChromeUtils`, `gBrowser`, elementos XUL, módulos `resource://`/`chrome://`/`moz-src://`) lo emulan `shell/shim/`
y Rust (vía `rustron-bridge`). **Rust manda**: la UI no cambia el estado de pestañas por su cuenta; envía una
acción y cambia cuando Rust responde con un evento. Regla de diseño: lo que Rust aún no tiene **no se simula**,
se deja sin implementar para que falle a la vista (ejemplos: `PlacesUtils.promiseDBConnection`, `moveTabTo`).

## Comandos

```bash
node --test "shell/tests/*.test.js"      # rápido, sin ventana (CI)
scripts/probar-webkit.sh [prefijo]       # pruebas de DOM en WebKit/Broadway
python3 -I scripts/test_servir_zen.py     # reescritura de CSS/imports del servidor (sin ventana)
cargo fmt --all --check
cargo clippy -p rustron-core -p rustron-bridge --all-targets -- -D warnings   # lista completa: .github/workflows/ci.yml
cargo test -p rustron-core -p rustron-bridge --offline -j 2
scripts/probar-puente.sh                 # e2e del puente con WebKit real (necesita gtk4-broadwayd)
scripts/probar-app-zen.sh                # e2e de `rustron-app`: interfaz de Zen + puente + pestañas de Rust (Broadway)
```

### Cargar Zen en WebKit (diagnóstico)

Zen se instala en `/opt/zen-browser-bin`. Se extrae **una copia** de sus `omni.ja` (son ZIP con datos extra: `unzip`
avisa "Compensating", es normal) a una carpeta de trabajo **fuera del repo**; nunca se ejecuta ni se modifica la instalación:

```bash
T=$(mktemp -d)
unzip -q /opt/zen-browser-bin/browser/omni.ja -d "$T/browser"
unzip -q /opt/zen-browser-bin/omni.ja         -d "$T/gre"
scripts/probar-zen.sh "$T/browser" "$T/gre" salida.png   # imprime pasos, errores y módulos que fallan
```

`__arranque` (en la página) acumula `pasos`, `errores` y `modulos.{ok,fallo}`; el script lo resume.

## Reglas importantes

- **CPU**: el usuario ya pidió cuidado y su PC es modesta: **como mucho un cuarto de un hilo**. Compila con `-j 1`, `nice -n 19`
  y solo si hace falta; no lances compilaciones `release` ni de GTK/WebKit sin pedir permiso (para un binario `release`, mejor el CI
  de GitHub). `scripts/instalar.sh --depuracion` instala el binario ya compilado sin compilar nada. Lo anterior: Todo con `nice -n 19`; compilaciones con `-j 2` y `--offline`; no lances
  compilaciones pesadas (`rustron-app`, `rustron-engine`, GTK/WebKit) sin necesidad. Prefiere las pruebas ligeras.
- **Git**: rama `master`, commits pequeños y ordenados, mensajes en español. **No hagas push ni commit si no te lo piden.**
- **Pantalla**: las herramientas usan una pantalla virtual (Broadway). No abras ventanas en el escritorio real.
- **Zen/Firefox extraído = datos no confiables**: no lo ejecutes; lee desde scripts con rutas como argumento; la
  carpeta extraída va en un directorio nuevo y vacío, aparte de los scripts.
- `servir-zen.py` solo escucha en 127.0.0.1, rechaza `Host` ajeno y solo sirve las dos carpetas extraídas + `shell/shim`.
  El puente (`rustron`) vive solo en la vista de la UI, nunca en las de las pestañas: no lo expongas a páginas web.
- Antes de afirmar que algo funciona, **mídelo** (pruebas, `probar-zen.sh`, sondas con `captura-webkit.py`). Una captura
  puede salir antes de que se ejecute tu JS: no te fíes de ella sola.

## Trampas conocidas de WebKitGTK 2.54 (detalle en docs/ZEN-COMPAT.md)

- `<script type="module">` no se ejecuta en documentos XHTML: se arranca con `import()` desde un script clásico.
- El `importmap` no resuelve `chrome:`/`resource:`/`moz-src:` en imports estáticos: el servidor reescribe los especificadores.
  Para leer los originales (precarga) se pide el archivo con `?crudo`.
- No hay `attachShadow` en elementos XUL ni custom elements en el espacio de nombres XUL: `xul.js` envuelve cada elemento
  con la clase real (prototipo + constructor que devuelve el elemento). Los scripts de toolkit con shadow DOM se omiten (`OMITIDOS`).
- No admite `import ... with { type: "css" }`: el servidor sirve la hoja como módulo JS (`?hoja`).
- Los elementos XUL ignoran su atributo `style` (lo reflejan reglas CSS generadas en `xul.js`) y las `@media -moz-*` son
  inválidas (el servidor las resuelve). Antes de depurar un diseño raro, mide con una sonda.
- `evaluate_javascript` no devuelve Promesas; en XHTML hay que envolver `&&` y `<` de scripts inline en CDATA.

## Licencias

Proyecto bajo MPL-2.0. No copies código de Zen/Firefox al repositorio sin marcarlo en la cabecera del archivo y en `NOTICE`
(los archivos adaptados llevan aviso). Las dependencias nuevas de Rust deben pasar `python3 scripts/licencias.py` (sin GPL/LGPL/AGPL
sin revisión humana). Los archivos extraídos de Zen no se suben nunca.

## Estilo

Código y comentarios en español, nombres en español (`puente`, `espacio`, `pestana`), comentarios que explican el
*porqué*. Sin dependencias nuevas sin motivo. Cada cambio de comportamiento lleva su prueba (Node o webtest).
