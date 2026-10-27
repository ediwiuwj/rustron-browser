#!/usr/bin/env bash
# Instala el host de Rustron para la extensión de ajustes de Zen.
# No toca ningún perfil de Zen. Solo escribe el binario y el manifiesto nativo.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
destino_bin="$HOME/.local/bin/rustron-host"
carpeta_manifiesto="$HOME/.mozilla/native-messaging-hosts"

cargo build --release -p rustron-host --manifest-path "$raiz/Cargo.toml"
install -Dm755 "$raiz/target/release/rustron-host" "$destino_bin"

mkdir -p "$carpeta_manifiesto"
sed "s#__RUTA__#$destino_bin#" "$raiz/zen-extension/com.rustron.host.json" \
  > "$carpeta_manifiesto/com.rustron.host.json"

echo "Host instalado en $destino_bin"
echo "Manifiesto nativo en $carpeta_manifiesto/com.rustron.host.json"
echo "Siguiente paso: cargar zen-extension/ como extensión temporal en un perfil de prueba."
