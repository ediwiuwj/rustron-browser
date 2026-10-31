#!/usr/bin/env python3
"""Comprueba las licencias de las dependencias de Rust y avisa de las que no estén permitidas.

Uso: licencias.py [--offline] [--lista]
Lee `cargo metadata`. Una expresión SPDX es aceptable si lo es al menos una alternativa de cada
`OR` y todos los términos de cada `AND`. Sale con 1 si alguna dependencia no es aceptable o no
declara licencia. Con --lista imprime todas (nombre, versión, licencia), útil para NOTICE.
Las licencias de copyleft fuerte o de red (GPL, AGPL, LGPL, SSPL...) quedan fuera a propósito:
revísalas a mano antes de admitirlas.
"""

import json
import re
import subprocess
import sys

PERMITIDAS = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unlicense", "0BSD",
    "Unicode-3.0", "CDLA-Permissive-2.0", "MPL-2.0", "LLVM-exception", "CC0-1.0",
}


def aceptable(expresion: str) -> bool:
    fichas = re.findall(r"\(|\)|[A-Za-z0-9.+-]+", expresion.replace("/", " OR "))
    posicion = 0

    def alternativas() -> bool:  # términos unidos por OR
        nonlocal posicion
        resultado = conjunto()
        while posicion < len(fichas) and fichas[posicion] == "OR":
            posicion += 1
            resultado = conjunto() or resultado
        return resultado

    def conjunto() -> bool:  # términos unidos por AND
        nonlocal posicion
        resultado = termino()
        while posicion < len(fichas) and fichas[posicion] == "AND":
            posicion += 1
            resultado = termino() and resultado
        return resultado

    def termino() -> bool:
        nonlocal posicion
        if fichas[posicion] == "(":
            posicion += 1
            valor = alternativas()
            posicion += 1  # ")"
            return valor
        nombre = fichas[posicion]
        posicion += 1
        if posicion < len(fichas) and fichas[posicion] == "WITH":
            posicion += 2  # la excepción (p. ej. LLVM-exception) no cambia la licencia base
        return nombre.rstrip("+") in PERMITIDAS

    return alternativas()


def main() -> int:
    orden = ["cargo", "metadata", "--format-version", "1"] + (["--offline"] if "--offline" in sys.argv else [])
    datos = json.loads(subprocess.run(orden, check=True, capture_output=True, text=True).stdout)
    propios = set(datos["workspace_members"])
    problemas = []
    for paquete in sorted(datos["packages"], key=lambda p: p["name"]):
        if paquete["id"] in propios:
            continue
        licencia = paquete.get("license")
        if "--lista" in sys.argv:
            print(f'{paquete["name"]} {paquete["version"]}: {licencia}')
        if not licencia:
            problemas.append(f'{paquete["name"]} {paquete["version"]}: sin licencia declarada')
        elif not aceptable(licencia):
            problemas.append(f'{paquete["name"]} {paquete["version"]}: {licencia}')
    for linea in problemas:
        print("licencia no permitida:", linea)
    print(f"{len(datos['packages']) - len(propios)} dependencias revisadas, {len(problemas)} con problemas")
    return 1 if problemas else 0


if __name__ == "__main__":
    raise SystemExit(main())
