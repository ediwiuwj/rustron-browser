#!/usr/bin/env python3
"""Prototipo: renderiza el DOM y el CSS reales de Zen en WebKit.

Uso: prototipo-zen-ui.py <carpeta-extraida-de-omni.ja> <carpeta-de-salida>

Convierte las direcciones chrome:// a rutas locales, quita los <script> y añade
una hoja mínima de compatibilidad para los elementos XUL. Solo lee la carpeta de
entrada: no toca ninguna instalación ni perfil de Zen.
"""

import re
import shutil
import sys
from pathlib import Path

PREFIJOS = [
    ("chrome://browser/content/", "chrome/browser/content/browser/"),
    ("chrome://browser/skin/", "chrome/browser/skin/classic/browser/"),
    ("chrome://global/content/", "chrome/toolkit/content/global/"),
    ("chrome://global/skin/", "chrome/toolkit/skin/classic/global/"),
]

HOJAS_BASE = [
    "chrome://global/content/xul.css",
    "chrome://global/skin/global.css",
    "chrome://browser/skin/browser.css",
]

COMPAT_CSS = """
/* Compatibilidad mínima de elementos XUL para WebKit */
hbox, box { display: flex; flex-direction: row; }
vbox { display: flex; flex-direction: column; }
spacer { flex: 1; }
toolbar, toolbaritem, toolbarbutton, toolbarspring { display: flex; align-items: center; }
toolbarspring { flex: 1; }
[hidden="true"], [hidden], [collapsed="true"] { display: none !important; }
html, body { margin: 0; height: 100%; }
"""


def reescribir(texto: str, raiz: Path) -> str:
    for origen, destino in PREFIJOS:
        texto = texto.replace(origen, f"file://{raiz}/{destino}")
    return texto


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    entrada, salida = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    if salida.exists():
        shutil.rmtree(salida)
    shutil.copytree(entrada / "chrome", salida / "chrome")

    for css in (salida / "chrome").rglob("*.css"):
        try:
            texto = css.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        css.write_text(reescribir(texto, salida), encoding="utf-8")

    (salida / "compat.css").write_text(COMPAT_CSS, encoding="utf-8")

    fuente = (entrada / "chrome/browser/content/browser/browser.xhtml").read_text(encoding="utf-8")
    fuente = re.sub(r"<(?:html:)?script\b[^>]*?/>", "", fuente, flags=re.S)
    fuente = re.sub(r"<(?:html:)?script\b[^>]*?>.*?</(?:html:)?script>", "", fuente, flags=re.S)
    fuente = reescribir(fuente, salida)

    enlaces = "".join(
        f'<link rel="stylesheet" href="{reescribir(h, salida)}"/>' for h in HOJAS_BASE
    ) + f'<link rel="stylesheet" href="file://{salida}/compat.css"/>'
    if "<head>" in fuente:
        fuente = fuente.replace("<head>", "<head>" + enlaces, 1)
    else:
        print("aviso: browser.xhtml no tiene <head>; no se añadieron hojas base")

    destino = salida / "ui.xhtml"
    destino.write_text(fuente, encoding="utf-8")
    print(f"escrito {destino} ({destino.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
