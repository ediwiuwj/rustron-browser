#!/usr/bin/env bash
# Ejecuta pruebas de DOM de shell/webtests/*.webtest.js dentro de WebKit, en una pantalla
# virtual Broadway (no abre nada en el escritorio real). Uso: probar-webkit.sh [nombre]
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
trabajo="$(mktemp -d)"
trap 'rm -rf "$trabajo"' EXIT

# Corre con la prioridad más baja para no competir con el escritorio.
exec nice -n 19 python3 -I - "$raiz" "$trabajo" "${1:-}" <<'PY'
import json, pathlib, re, subprocess, sys

raiz, trabajo, filtro = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]

def sin_export(texto):
    return re.sub(r"^export\s+(default\s+)?", "", texto, flags=re.M)

shim = "\n".join(sin_export(p.read_text(encoding="utf-8")) for p in [raiz / "shell/shim/xul.js"])
arnes = """
const __resultados = [];
const prueba = (nombre, fn) => __resultados.push({ nombre, fn });
const igual = (real, esperado) => {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    throw new Error("esperado " + JSON.stringify(esperado) + ", real " + JSON.stringify(real));
  }
};
"""
final = """
window.__resultado = null;
(async () => {
  const salida = [];
  for (const { nombre, fn } of __resultados) {
    try { await fn(); salida.push({ nombre, ok: true }); }
    catch (e) { salida.push({ nombre, ok: false, error: String(e && e.message || e) }); }
  }
  window.__resultado = salida;
})();
"""
pruebas = sorted((raiz / "shell/webtests").glob(f"{filtro}*.webtest.js"))
if not pruebas:
    sys.exit(f"no hay pruebas que coincidan con '{filtro}'")
codigo = "\n".join(sin_export(p.read_text(encoding="utf-8")) for p in pruebas)
pagina = trabajo / "prueba.html"
pagina.write_text(f"<!doctype html><meta charset=\"utf-8\"><body><script>\n{arnes}\n{shim}\n{codigo}\n{final}\n</script></body>", encoding="utf-8")
(trabajo / "leer.js").write_text("JSON.stringify(window.__resultado)", encoding="utf-8")

proceso = subprocess.run(
    [sys.executable, str(raiz / "scripts/captura-webkit.py"), f"file://{pagina}",
     str(trabajo / "captura.png"), "400", "300", "2", str(trabajo / "leer.js")],
    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
linea = next((l for l in proceso.stdout.splitlines() if l.startswith("JS ->")), None)
if linea is None or linea.strip() == "JS -> null":
    sys.exit("las pruebas no terminaron en WebKit:\n" + proceso.stdout + proceso.stderr[-500:])
resultados = json.loads(linea[len("JS -> "):])
for r in resultados:
    print(("ok   " if r["ok"] else "FALLA"), r["nombre"], "" if r["ok"] else "-> " + r["error"])
fallidas = sum(not r["ok"] for r in resultados)
print(f"\n{len(resultados) - fallidas}/{len(resultados)} pruebas correctas")
sys.exit(1 if fallidas else 0)
PY
