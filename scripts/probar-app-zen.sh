#!/usr/bin/env bash
# Prueba de punta a punta de `rustron-app --zen`: la interfaz real de Zen en un WebView, el puente real,
# y las pestañas web como vistas de WebKit de Rust. Corre en una pantalla virtual Broadway (no abre nada en
# el escritorio real). Necesita Zen instalado (RUSTRON_ZEN, /opt/zen-browser-bin por defecto), gtk4-broadwayd
# y python3. La primera vez extrae una copia de Zen a la caché de pruebas (unos 20 s).
# Uso: probar-app-zen.sh [captura.png]
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
trabajo="$(mktemp -d)"
cache="${RUSTRON_CACHE_PRUEBAS:-$HOME/.cache/rustron-pruebas}"
png="${1:-$trabajo/ventana.png}"
pantalla=":7"
puerto_web=8791
mkdir -p "$cache" "$trabajo/web" "$trabajo/config"

cleanup() { kill $(jobs -p) 2>/dev/null || true; rm -rf "$trabajo"; }
trap cleanup EXIT

cd "$raiz"
nice -n 19 cargo build -p rustron-app --offline -j 2 --quiet

printf '<html><head><meta charset="utf-8"><title>Primera</title></head><body style="background:#cfe8ff"><h1>Primera</h1></body></html>' > "$trabajo/web/p.html"
printf '<html><head><meta charset="utf-8"><title>Segunda</title></head><body style="background:#ffe0e0"><h1>Segunda</h1></body></html>' > "$trabajo/web/q.html"
(cd "$trabajo/web" && exec python3 -m http.server "$puerto_web" --bind 127.0.0.1 >/dev/null 2>&1) &
sed "s/PUERTO_WEB/$puerto_web/g" scripts/escenario-zen.js > "$trabajo/escenario.js"

gtk4-broadwayd "$pantalla" >/dev/null 2>&1 &
sleep 1
GDK_BACKEND=broadway BROADWAY_DISPLAY="$pantalla" \
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 \
XDG_DATA_HOME="$cache" XDG_CONFIG_HOME="$trabajo/config" \
RUSTRON_CAPTURA="$png" RUSTRON_CAPTURA_SEGUNDOS=25 RUSTRON_SONDA="$trabajo/escenario.js" \
  nice -n 19 timeout 150 target/debug/rustron-app --zen "http://127.0.0.1:$puerto_web/p.html" 2>"$trabajo/salida.log" || true

python3 -I - "$trabajo/salida.log" <<'PY'
import re, sys
pasos = dict(re.findall(r"^SONDA (\d+) -> (.*)$", open(sys.argv[1], encoding="utf-8").read(), re.M))
esperado = {
    "0": '["1:Primera*","null:null(vacia)"]',
    "2": '["1:Primera","2:Segunda*","null:null(vacia)"]',
    "4": '["1:Primera*","2:Segunda","null:null(vacia)"]',
    "6": '["1:Segunda*","2:Segunda","null:null(vacia)"]',
    "8": '["1:Segunda*","null:null(vacia)"]',
}
malos = [(n, pasos.get(n), e) for n, e in esperado.items() if pasos.get(n) != e]
for n, real, e in malos:
    print(f"FALLO en el paso {n}: esperado {e}, real {real}")
print("OK" if not malos else "FALLO")
sys.exit(1 if malos else 0)
PY
