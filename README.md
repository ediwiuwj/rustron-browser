# Rustron

Navegador ligero para Linux, escrito en Rust y construido sobre
[Servo](https://github.com/servo/servo). Pensado para Wayland y Hyprland.

Estado: **Fase 0 — spike de viabilidad.** Todavía no hay navegador usable.

Plan completo: [`docs/PLAN.html`](docs/PLAN.html).

## Desarrollo en GitHub Codespaces

Las compilaciones se hacen en un Codespace (Servo tarda mucho y pesa).
Abre el repositorio en Codespaces con la configuración de `.devcontainer/`
(8 CPU, 32 GB de RAM recomendados).

Dentro del Codespace:

```bash
cargo build -p rustron-app
cargo run -p rustron-app
```

La primera compilación descarga y compila Servo; puede tardar bastante.

## Estructura

```
crates/
├─ rustron-app/     binario
└─ rustron-engine/  capa de motor (único crate que conoce servo)
```

Más crates (`rustron-core`, `rustron-ui`, `rustron-store`,
`rustron-config`, `rustron-adblock`) se añadirán según avance la Fase A.

## Licencia

MPL-2.0. Ver [`LICENSE`](LICENSE) y [`NOTICE`](NOTICE).
