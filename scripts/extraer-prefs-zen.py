#!/usr/bin/env python3
"""Extrae los valores por defecto de preferencias de Zen/Firefox a JSON.

Uso: extraer-prefs-zen.py <carpeta-extraida-de-omni.ja> <salida.json> [prefijos...]
Lee las líneas pref("nombre", valor) de defaults/preferences/*.js. Solo lectura.
"""

import json
import re
import sys
from pathlib import Path

LINEA = re.compile(r'^\s*(?:sticky_)?pref\(\s*"([^"]+)"\s*,\s*(.+?)\s*(?:,\s*(?:locked|sticky))?\s*\)\s*;?\s*(?://.*)?$')


def valor(texto: str):
    texto = texto.strip()
    if texto in ("true", "false"):
        return texto == "true"
    if re.fullmatch(r"-?\d+", texto):
        return int(texto)
    if len(texto) >= 2 and texto[0] == texto[-1] == '"':
        try:
            return json.loads(texto)
        except json.JSONDecodeError:
            return None
    return None


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    base, salida = Path(sys.argv[1]), Path(sys.argv[2])
    prefijos = tuple(sys.argv[3:])
    resultado, omitidas = {}, 0
    for archivo in sorted((base / "defaults/preferences").glob("*.js")):
        for linea in archivo.read_text(encoding="utf-8", errors="replace").splitlines():
            m = LINEA.match(linea)
            if not m:
                continue
            nombre, crudo = m.groups()
            if prefijos and not nombre.startswith(prefijos):
                continue
            v = valor(crudo)
            if v is None:
                omitidas += 1
                continue
            resultado[nombre] = v
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(dict(sorted(resultado.items())), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(resultado)} preferencias escritas en {salida} ({omitidas} omitidas por tener valor no literal)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
