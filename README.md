# Rustron

Navegador ligero para Linux (Wayland/Hyprland), escrito en Rust sobre **WebKitGTK 6.0 + GTK4**,
con la interfaz de [Zen Browser](https://zen-browser.app). Bloqueador de anuncios con
[`adblock-rust`](https://github.com/brave/adblock-rust) (el motor de Brave).

Estado: **en desarrollo, todavía no es un navegador usable.** Hay dos frentes:

1. **App GTK propia** (`rustron-app`): pestañas, barra lateral, barra de URL, adblock y tema.
2. **Capa de compatibilidad Zen** (`shell/`): ejecutar el CSS y el JS reales de Zen (MPL-2.0) dentro
   de un WebView, con Rust como backend que hace de "Firefox". Es la vía elegida para tener la interfaz
   de Zen. Estado y hallazgos: [`docs/ZEN-COMPAT.md`](docs/ZEN-COMPAT.md).

Si eres una IA o te incorporas al proyecto, empieza por [`AGENTS.md`](AGENTS.md).

## Estructura

```
crates/
├─ rustron-core/     modelo del navegador (pestañas, espacios, acciones); sin GTK
├─ rustron-engine/   capa de motor: el único crate que conoce webkit6
├─ rustron-app/      binario GTK4
├─ rustron-bridge/   puente JSON entre la UI de Zen (WebView) y rustron-core
├─ rustron-adblock/  listas ABP -> reglas de contenido de WebKit
├─ rustron-theme/    esquema de colores (Caelestia) -> CSS de GTK4
├─ rustron-config/   configuración TOML
├─ rustron-store/    persistencia (historial y sesión, con migraciones)
├─ rustron-prefs/    genera user.js para Zen desde TOML
└─ rustron-host/     native messaging para la extensión de ajustes de Zen
shell/               capa Zen en JS: shim de Firefox (shim/), pruebas Node (tests/) y de DOM (webtests/)
scripts/             herramientas de prueba y diagnóstico (todas aisladas, no tocan el escritorio)
zen-extension/       extensión de ajustes de Zen (usa rustron-host)
docs/                PLAN.html (plan general) y ZEN-COMPAT.md (capa Zen, hallazgos y estado)
```

## Desarrollo

Rust 1.92 (`rust-toolchain.toml`). Compilar la app (GTK/WebKit) es pesado: usa `nice -n 19` y `-j 2`,
o un Codespace (`.devcontainer/`).

```bash
cargo fmt --all --check
cargo clippy -p rustron-core -p rustron-bridge --all-targets -- -D warnings
cargo test  -p rustron-core -p rustron-bridge          # (la lista completa está en .github/workflows/ci.yml)
node --test "shell/tests/*.test.js"                    # capa Zen, sin ventana
scripts/probar-webkit.sh                               # pruebas de DOM en WebKit (pantalla virtual Broadway)
```

## Licencia

MPL-2.0. Ver [`LICENSE`](LICENSE) y [`NOTICE`](NOTICE).
