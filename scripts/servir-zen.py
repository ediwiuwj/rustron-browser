#!/usr/bin/env python3
"""Sirve la ventana de Zen (DOM, CSS y JS reales) para cargarla en WebKit.

Uso: servir-zen.py <extraido-de-browser/omni.ja> <extraido-de-omni.ja> [puerto]

Solo escucha en 127.0.0.1 y solo lee de las dos carpetas indicadas y de shell/shim.
Reescribe al vuelo las direcciones chrome:// y resource:// de CSS y de la ventana, y
genera ui.xhtml a partir de browser.xhtml. No toca ninguna instalación ni perfil de Zen.
"""

import os
import json
import posixpath
import mimetypes
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SHIM = RAIZ / "shell" / "shim"

# Origen -> ruta HTTP. Es la misma tabla que usa el cargador de módulos del navegador.
MAPAS = [
    ("chrome://browser/content/", "/browser/chrome/browser/content/browser/"),
    ("chrome://browser/skin/", "/browser/chrome/browser/skin/classic/browser/"),
    ("chrome://global/content/", "/gre/chrome/toolkit/content/global/"),
    ("chrome://global/skin/", "/gre/chrome/toolkit/skin/classic/global/"),
    ("resource:///modules/", "/browser/modules/"),
    ("resource://gre/modules/", "/gre/modules/"),
    ("resource://services-common/", "/gre/modules/services-common/"),
    ("resource://services-settings/", "/gre/modules/services-settings/"),
    ("resource://gre/", "/gre/"),
    ("moz-src:///", "/gre/moz-src/"),
]

HOJAS_BASE = [
    "chrome://global/content/xul.css",
    "chrome://global/skin/global.css",
    "chrome://browser/skin/browser.css",
]


# Firefox pinta los iconos de XUL con `list-style-image` sobre <image> (y los de Zen, SVG monocromos, se
# tiñen con -moz-context-properties/context-fill). WebKit no hace ninguna de las dos cosas: cada
# declaración se acompaña de variables que shell/shim/compat-xul.css convierte en fondo o en máscara
# (la máscara toma el color del texto, que es lo que Zen usa de relleno casi siempre).
LISTA_IMAGEN = re.compile(r"list-style-image\s*:\s*(?P<valor>[^;}]+?)\s*(?P<imp>!important)?\s*(?=[;}])")


URL_RELATIVA = re.compile(r"""url\(\s*(["']?)(?![a-z][a-z0-9+.-]*:|/|#)([^"')]+)\1\s*\)""", re.I)


def _imagen_de_lista(m: re.Match, directorio: str) -> str:
    # Una URL relativa dentro de una variable se resuelve contra la hoja que la USA, no la que la declara.
    valor = URL_RELATIVA.sub(lambda u: f'url("{posixpath.normpath(posixpath.join(directorio, u.group(2)))}")', m.group("valor"))
    imp = " !important" if m.group("imp") else ""
    original = f"list-style-image: {valor}{imp}"
    if re.search(r"\.svg[\"']?\s*\)", valor):  # SVG de iconos: monocromos, rellenos con context-fill
        return f"{original}; --rustron-icono: {valor}{imp}; --rustron-imagen: none{imp}; --rustron-fondo-icono: currentColor{imp}"
    if valor.strip() == "none":
        return f"{original}; --rustron-icono: none{imp}; --rustron-imagen: none{imp}; --rustron-fondo-icono: transparent{imp}"
    return f"{original}; --rustron-imagen: {valor}{imp}; --rustron-icono: none{imp}; --rustron-fondo-icono: transparent{imp}"


def reescribir(texto: str, ruta: str = "/") -> str:
    """`ruta`: dónde se sirve la hoja (para resolver las URL relativas de los iconos)."""
    for origen, destino in MAPAS:
        texto = texto.replace(origen, destino)
    directorio = posixpath.dirname(ruta)
    return LISTA_IMAGEN.sub(lambda m: _imagen_de_lista(m, directorio), texto)


# Módulos de Firefox con otra ruta que sustituimos por uno propio.
SUSTITUTOS = {
    "moz-src:///browser/components/tabbrowser/Tabbrowser.sys.mjs": "/shim/modulos/Tabbrowser.sys.mjs",
    "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs": "/shim/modulos/SessionStore.sys.mjs",
    "moz-src:///toolkit/components/search/SearchService.sys.mjs": "/shim/modulos/SearchService.sys.mjs",
    "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs": "/shim/modulos/TabStateFlusher.sys.mjs",
    "resource:///modules/webrtcUI.sys.mjs": "/shim/modulos/webrtcUI.sys.mjs",
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs": "/shim/modulos/CustomizableUI.sys.mjs",
    "moz-src:///browser/components/aiwindow/ui/modules/AIWindow.sys.mjs": "/shim/modulos/AIWindow.sys.mjs",
}


def destino(url: str) -> str | None:
    """Ruta HTTP de un módulo; los módulos propios de Rustron tapan a los de Firefox."""
    if url in SUSTITUTOS:
        return SUSTITUTOS[url]
    nombre = url.rsplit("/", 1)[-1]
    if url.startswith(("resource://gre/modules/", "resource://nimbus/")) and (SHIM / "modulos" / nombre).is_file():
        return f"/shim/modulos/{nombre}"
    for origen, ruta in MAPAS:
        if url.startswith(origen):
            return ruta + url[len(origen):]
    return None


# import/export ... from "x", import "x" e import("x" con esquema chrome:, resource: o moz-src:.
IMPORTS = re.compile(
    r"""((?:\bimport|\bexport)\b[^;"']*?\bfrom\s*|\bimport\s*\(?\s*)(["'])((?:chrome|resource|moz-src):[^"']+)\2"""
)


# Los módulos de la barra de direcciones se reexportan a sí mismos desde el "global de sistema":
#   if (typeof ChromeUtils != "undefined" && typeof window != "undefined") { ({ X } = ChromeUtils.importESModule("<este mismo archivo>")); }
# Es una guarda contra fugas de ventanas en Firefox; aquí no hay global de sistema separado y el
# módulo todavía se está evaluando (no puede importarse a sí mismo), así que se quita el bloque.
AUTOIMPORTACION = re.compile(
    r'if \(typeof ChromeUtils != "undefined" && typeof window != "undefined"\) \{.*?\n\}', re.S
)


def aplicar_parches(ruta: str, texto: str) -> str:
    if "/urlbar/" not in ruta:
        return texto
    nombre = ruta.rsplit("/", 1)[-1]

    def quitar(m: re.Match) -> str:
        bloque = m.group(0)
        if "importESModule" in bloque and nombre in bloque:
            return "// (Rustron) sin global de sistema separado: no hay nada que reexportar."
        return bloque

    return AUTOIMPORTACION.sub(quitar, texto)


def reescribir_imports(texto: str) -> str:
    """El importmap de WebKit no resuelve esquemas no estándar en imports estáticos
    (los módulos fallan con `Importing a module script failed`), así que se reescriben aquí.
    Las cadenas usadas en tiempo de ejecución (importESModule...) no se tocan."""

    def cambiar(m: re.Match) -> str:
        ruta = destino(m.group(3))
        return m.group(0) if ruta is None else f"{m.group(1)}{m.group(2)}{ruta}{m.group(2)}"

    return IMPORTS.sub(cambiar, texto)


def importmap() -> str:
    imports = {origen: destino for origen, destino in MAPAS if origen.startswith(("resource:", "chrome:", "moz-src:"))}
    # Los módulos propios de Rustron tapan a los de Firefox con el mismo nombre.
    for archivo in sorted((SHIM / "modulos").glob("*.sys.mjs")):
        imports[f"resource://gre/modules/{archivo.name}"] = f"/shim/modulos/{archivo.name}"
        if archivo.name == "ExperimentAPI.sys.mjs":
            imports[f"resource://nimbus/{archivo.name}"] = f"/shim/modulos/{archivo.name}"
    imports.update(SUSTITUTOS)
    return json.dumps({"imports": imports}, indent=1)


def pagina(raiz_browser: Path) -> bytes:
    fuente = (raiz_browser / "chrome/browser/content/browser/browser.xhtml").read_text(encoding="utf-8")
    fuente = re.sub(r"<(?:html:)?script\b[^>]*?/>", "", fuente, flags=re.S)
    fuente = re.sub(r"<(?:html:)?script\b[^>]*?>.*?</(?:html:)?script>", "", fuente, flags=re.S)
    fuente = re.sub(r'<meta\s+http-equiv="Content-Security-Policy"[^>]*?/>', "", fuente, flags=re.S)
    fuente = reescribir(fuente)
    fuente = fuente.replace(
        'href="/browser/chrome/browser/skin/classic/browser/"',
        'href="/browser/chrome/browser/skin/classic/browser/browser.css"',
    )
    xhtml = 'xmlns="http://www.w3.org/1999/xhtml"'
    inicio = fuente.index("<html")
    fin = fuente.index(">", inicio)
    etiqueta = fuente[inicio:fin]
    if xhtml in etiqueta:
        etiqueta = etiqueta.replace(xhtml, "", 1).replace("<html", f"<html {xhtml}", 1)
        fuente = fuente[:inicio] + etiqueta + fuente[fin:]
    # Anota los errores desde el primer instante, también los de carga de <script>.
    temprano = (
        "<script><![CDATA[window.__tempranos=[];addEventListener('error',function(e){"
        "__tempranos.push(String(e.message||'')+' @'+String((e.target&&(e.target.src||e.target.localName))||e.filename||''));"
        "},true);]]></script>"
    )
    cabecera = (
        temprano
        + f'<script type="importmap">{importmap()}</script>'
        + "".join(f'<link rel="stylesheet" href="{reescribir(h)}"/>' for h in HOJAS_BASE)
        + '<link rel="stylesheet" href="/shim/compat-xul.css"/>'
        # WebKit no ejecuta <script type="module"> en documentos XML: se importa desde uno clásico.
        + "<script><![CDATA[import('/shim/arranque.js').catch(function(e){"
        "__tempranos.push('import arranque: '+(e&&e.message||e));});]]></script>"
    )
    fuente = fuente.replace("<head>", "<head>" + cabecera, 1)
    return fuente.encode("utf-8")


def crear_manejador(raiz_browser: Path, raiz_gre: Path):
    raices = {"browser": raiz_browser, "gre": raiz_gre, "shim": SHIM}

    class Manejador(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def responder(self, codigo: int, cuerpo: bytes, tipo: str):
            if codigo >= 400 and os.environ.get("RUSTRON_REGISTRO"):  # diagnóstico: qué recursos faltan
                print(codigo, self.path, flush=True)
            self.send_response(codigo)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(cuerpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(cuerpo)

        def do_GET(self):
            # Solo se atiende a quien llega por 127.0.0.1/localhost: evita el "DNS rebinding" (una página
            # web que apunte un nombre suyo a este servidor y lea lo que sirve).
            if self.headers.get("Host", "").rsplit(":", 1)[0] not in ("127.0.0.1", "localhost"):
                return self.responder(403, b"host no permitido", "text/plain")
            ruta, _, consulta = self.path.partition("?")
            crudo = "crudo" in consulta  # sin reescribir imports: para que el cliente lea los originales
            if ruta in ("/", "/ui.xhtml"):
                return self.responder(200, pagina(raiz_browser), "application/xhtml+xml; charset=utf-8")
            partes = ruta.lstrip("/").split("/", 1)
            raiz = raices.get(partes[0])
            if raiz is None or len(partes) < 2:
                return self.responder(404, b"no existe", "text/plain")
            archivo = (raiz / partes[1]).resolve()
            if not archivo.is_relative_to(raiz.resolve()) or not archivo.is_file():
                return self.responder(404, b"no existe", "text/plain")
            datos = archivo.read_bytes()
            if archivo.suffix in (".mjs", ".js"):
                tipo = "text/javascript; charset=utf-8"
                texto = aplicar_parches(str(archivo), datos.decode("utf-8", "replace"))
                datos = (texto if crudo else reescribir_imports(texto)).encode("utf-8")
            elif archivo.suffix == ".css":
                tipo = "text/css; charset=utf-8"
                datos = reescribir(datos.decode("utf-8", "replace"), ruta).encode("utf-8")
            else:
                tipo = mimetypes.guess_type(archivo.name)[0] or "application/octet-stream"
            self.responder(200, datos, tipo)

    return Manejador


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    raiz_browser, raiz_gre = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    puerto = int(sys.argv[3]) if len(sys.argv) > 3 else 8765
    servidor = ThreadingHTTPServer(("127.0.0.1", puerto), crear_manejador(raiz_browser, raiz_gre))
    print(f"sirviendo en http://127.0.0.1:{puerto}/ui.xhtml", flush=True)
    servidor.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
