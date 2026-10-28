#!/usr/bin/env python3
"""Carga una página en WebKitGTK dentro de una pantalla virtual (Broadway) y guarda un PNG.

No abre ventanas en el escritorio real. Uso:
    captura-webkit.py <url> <salida.png> [ancho] [alto] [segundos_de_espera] [archivo.js]

Si se indica un archivo .js, se ejecuta en la página antes de capturar y se imprime
su resultado (útil para diagnosticar).

Requiere gtk4-broadwayd. Arranca y detiene su propio servidor Broadway.
"""

import os
import subprocess
import sys
import time

DISPLAY = ":7"


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    url, salida = sys.argv[1], sys.argv[2]
    ancho = int(sys.argv[3]) if len(sys.argv) > 3 else 1328
    alto = int(sys.argv[4]) if len(sys.argv) > 4 else 748
    espera = float(sys.argv[5]) if len(sys.argv) > 5 else 4.0
    js = open(sys.argv[6], encoding="utf-8").read() if len(sys.argv) > 6 else None

    broadway = subprocess.Popen(
        ["gtk4-broadwayd", DISPLAY], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    time.sleep(1.0)
    os.environ["GDK_BACKEND"] = "broadway"
    os.environ["BROADWAY_DISPLAY"] = DISPLAY
    os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
    os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
    os.environ.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")

    try:
        import gi

        gi.require_version("Gtk", "4.0")
        gi.require_version("WebKit", "6.0")
        from gi.repository import GLib, Gtk, WebKit

        Gtk.init()
        ventana = Gtk.Window(default_width=ancho, default_height=alto)
        vista = WebKit.WebView()
        ventana.set_child(vista)
        ventana.present()
        consola = []

        def al_mensaje(_vista, mensaje):
            consola.append(mensaje.get_message() if hasattr(mensaje, "get_message") else str(mensaje))

        vista.connect(
            "load-failed",
            lambda _v, _e, uri, err: print("LOAD-FAILED", uri, err.message) or False,
        )
        vista.connect("load-changed", lambda _v, ev: print("load:", ev.value_nick))
        vista.load_uri(url)
        bucle = GLib.MainLoop()
        resultado = {"ok": False}

        def tomar():
            if js:
                def js_listo(origen, res):
                    try:
                        print("JS ->", origen.evaluate_javascript_finish(res).to_string())
                    except Exception as error:  # noqa: BLE001
                        print("JS fallo:", error)
                    capturar()

                vista.evaluate_javascript(js, -1, None, None, None, js_listo)
            else:
                capturar()
            return False

        def capturar():
            def listo(origen, res):
                try:
                    textura = origen.get_snapshot_finish(res)
                    textura.save_to_png(salida)
                    resultado["ok"] = True
                except Exception as error:  # noqa: BLE001
                    print("fallo al capturar:", error)
                bucle.quit()

            vista.get_snapshot(
                WebKit.SnapshotRegion.VISIBLE, WebKit.SnapshotOptions.NONE, None, listo
            )

        GLib.timeout_add(int(espera * 1000), tomar)
        GLib.timeout_add(int((espera + 15) * 1000), lambda: (bucle.quit(), False)[1])
        bucle.run()
        print("título:", vista.get_title())
        print("capturado" if resultado["ok"] else "SIN CAPTURA")
        return 0 if resultado["ok"] else 1
    finally:
        broadway.terminate()


if __name__ == "__main__":
    raise SystemExit(main())
