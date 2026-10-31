#!/usr/bin/env bash
# Prueba de punta a punta del puente UI <-> Rust con un WebKit real, dentro de una
# pantalla virtual Broadway. No abre ventanas en el escritorio real.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
pantalla=":8"

gtk4-broadwayd "$pantalla" >/dev/null 2>&1 &
servidor=$!
trap 'kill "$servidor" 2>/dev/null || true' EXIT
sleep 1

cd "$raiz"
GDK_BACKEND=broadway BROADWAY_DISPLAY="$pantalla" \
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 \
  cargo run --quiet -p rustron-app --example puente_e2e
