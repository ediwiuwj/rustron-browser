"""Pruebas de la reescritura de CSS e imports de servir-zen.py. Uso: python3 -I scripts/test_servir_zen.py"""
import importlib.util
import pathlib
import unittest

ruta = pathlib.Path(__file__).with_name("servir-zen.py")
spec = importlib.util.spec_from_file_location("servir_zen", ruta)
sz = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sz)


class Media(unittest.TestCase):
    def test_pref_falsa_negada_es_cierta(self):
        self.assertIn("not (min-width: 99999px)", sz.reescribir('@media not -moz-pref("pref.que.no.existe") { a{} }'))

    def test_pref_booleana_por_defecto(self):
        self.assertIn("@media (min-width: 0px) {", sz.reescribir('@media -moz-pref("zen.view.use-single-toolbar") {'))

    def test_plataforma(self):
        self.assertIn("@media (min-width: 0px) {", sz.reescribir("@media (-moz-platform: linux) {"))
        self.assertIn("@media (min-width: 99999px) {", sz.reescribir("@media (-moz-platform: macos) {"))

    def test_no_toca_media_normales(self):
        self.assertEqual(sz.reescribir("@media (width < 400px) {"), "@media (width < 400px) {")

    def test_ancho_disponible(self):
        self.assertIn("-webkit-fill-available", sz.reescribir("a { width: -moz-available !important }"))


class Pseudoclases(unittest.TestCase):
    def test_stack_superpone_sus_hijos(self):
        css = sz.reescribir("stack > *|*:not(:-moz-native-anonymous) { grid-area: 1 / 1; }")
        self.assertNotIn("-moz-", css)
        self.assertIn("stack > *|* {", css)

    def test_ventana_inactiva_y_foco(self):
        self.assertNotIn("-moz-", sz.reescribir("a:not(:-moz-window-inactive) { x: y } b:-moz-focusring { x: y }"))
        self.assertIn(":dir(rtl)", sz.reescribir("a:-moz-locale-dir(rtl) { x: y }"))


class Iconos(unittest.TestCase):
    def test_svg_relativo_pasa_a_mascara_con_url_absoluta(self):
        css = sz.reescribir('#b { list-style-image: url("plus.svg"); }', "/browser/skin/zen-icons/icons.css")
        self.assertIn('--rustron-icono: url("/browser/skin/zen-icons/plus.svg")', css)
        self.assertIn("--rustron-fondo-icono: currentColor", css)

    def test_imagen_no_svg_va_como_fondo(self):
        css = sz.reescribir("#b { list-style-image: url(a.png) }", "/x/y.css")
        self.assertIn('--rustron-imagen: url("/x/a.png")', css)

    def test_none_borra_el_icono(self):
        self.assertIn("--rustron-icono: none", sz.reescribir("#b { list-style-image: none }"))


class Imports(unittest.TestCase):
    def test_hoja_css_con_atributo_type_css(self):
        texto = 'import styles from "chrome://global/content/elements/moz-label.css" with { type: "css" };'
        salida = sz.reescribir_imports(texto)
        self.assertIn("moz-label.css?hoja", salida)
        self.assertNotIn("with", salida)

    def test_servir_hoja_exporta_una_hoja_construible(self):
        js = sz.servir_hoja("a { color: red }")
        self.assertIn("new CSSStyleSheet()", js)
        self.assertIn("export default hoja", js)


if __name__ == "__main__":
    unittest.main()
