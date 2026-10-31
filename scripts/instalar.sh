#!/usr/bin/env bash
# Instala Rustron para el usuario: binario en ~/.local/bin, la interfaz (servidor + shim) en
# ~/.local/share/rustron/interfaz y el lanzador del escritorio. Se puede repetir para actualizar.
# El binario anterior se conserva como rustron-app.antiguo.
# Uso: instalar.sh              compila en release (pesado, prioridad baja) e instala
#      instalar.sh --depuracion instala el binario de depuración ya compilado (target/debug), sin compilar nada
#      instalar.sh --paquete    instala el binario que viene en el paquete descargado de GitHub (./rustron-app)
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
bin="$HOME/.local/bin"
interfaz="$HOME/.local/share/rustron/interfaz"
lanzador="$HOME/.local/share/applications/rustron.desktop"

cd "$raiz"
case "${1:-}" in
  --depuracion)
    origen=target/debug/rustron-app
    [ -x "$origen" ] || { echo "no hay $origen: compílalo antes con cargo build -p rustron-app"; exit 1; }
    ;;
  --paquete)
    origen=rustron-app
    [ -x "$origen" ] || { echo "no hay ./rustron-app: ejecute esto desde la carpeta del paquete descargado"; exit 1; }
    ;;
  "")
    nice -n 19 cargo build --release -p rustron-app --offline -j 2
    origen=target/release/rustron-app
    ;;
  *)
    echo "opción desconocida: $1 (use --depuracion, --paquete o nada)"; exit 2
    ;;
esac

mkdir -p "$bin" "$interfaz/scripts" "$interfaz/shell" "$(dirname "$lanzador")"
if [ -f "$bin/rustron-app" ] && [ ! -f "$bin/rustron-app.antiguo" ]; then
  cp -p "$bin/rustron-app" "$bin/rustron-app.antiguo"
fi
install -m 755 "$origen" "$bin/rustron-app.nuevo"
mv -f "$bin/rustron-app.nuevo" "$bin/rustron-app"

# Copia de la interfaz: así el navegador no depende de que el repositorio siga en su sitio.
install -m 644 scripts/servir-zen.py "$interfaz/scripts/servir-zen.py"
rm -rf "$interfaz/shell/shim"
cp -r shell/shim "$interfaz/shell/shim"

cat > "$lanzador" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Rustron
GenericName=Navegador web
Comment=Navegador ligero en Rust con la interfaz de Zen
Exec=env RUSTRON_SERVIDOR=$interfaz/scripts/servir-zen.py $bin/rustron-app %U
Icon=$HOME/.local/share/icons/hicolor/256x256/apps/rustron.png
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=Rustron
DESKTOP
command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$lanzador")" || true
echo "Instalado: $bin/rustron-app (el anterior queda como rustron-app.antiguo)"
