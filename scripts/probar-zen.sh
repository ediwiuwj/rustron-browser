#!/usr/bin/env bash
# Carga la ventana real de Zen en WebKit (pantalla virtual Broadway, sin tocar el escritorio)
# y muestra los errores de arranque. Uso: probar-zen.sh <browser-omni-extraido> <gre-omni-extraido> [salida.png]
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
[ $# -ge 2 ] || { echo "uso: $0 <browser-omni-extraido> <gre-omni-extraido> [salida.png]"; exit 2; }
png="${3:-$(mktemp -d)/zen.png}"
trabajo="$(mktemp -d)"
puerto=8765

nice -n 19 python3 "$raiz/scripts/servir-zen.py" "$1" "$2" "$puerto" >/dev/null &
servidor=$!
trap 'kill "$servidor" 2>/dev/null || true; rm -rf "$trabajo"' EXIT
sleep 1

cat > "$trabajo/leer.js" <<'JS'
JSON.stringify(window.__arranque ? { hecho: window.__arranque.hecho, pasos: window.__arranque.pasos,
  errores: window.__arranque.errores, zen: window.__arranque.zen, modulosOk: window.__arranque.modulos.ok.length,
  modulosFallo: window.__arranque.modulos.fallo } : "sin __arranque")
JS

nice -n 19 python3 "$raiz/scripts/captura-webkit.py" "http://127.0.0.1:$puerto/ui.xhtml${RUSTRON_CONSULTA:-}" "$png" 1328 748 15 "$trabajo/leer.js" 2>&1 \
  | grep -E "^(JS|load-failed|LOAD-FAILED|capturado|SIN)" || true
echo "captura: $png"
