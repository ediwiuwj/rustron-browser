//! Tema de colores propio de Rustron para la interfaz GTK4.

use std::collections::BTreeMap;

const COLORES: &[(&str, &str)] = &[
    ("surface", "1c1c1e"),
    ("surfaceContainerLow", "1c1c1e"),
    ("surfaceContainer", "2c2c2e"),
    ("surfaceContainerHigh", "38383a"),
    ("onSurface", "ffffff"),
    ("onSurfaceVariant", "a3a3a5"),
    ("outlineVariant", "3a3a3c"),
    ("primary", "ff9f0a"),
    ("onPrimaryContainer", "eadbcd"),
    ("primaryContainer", "402f1d"),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paleta {
    colores: BTreeMap<String, String>,
}

impl Paleta {
    /// Devuelve la paleta integrada de Rustron, sin depender de temas externos.
    pub fn por_defecto() -> Self {
        Self {
            colores: COLORES
                .iter()
                .map(|(clave, valor)| ((*clave).to_string(), (*valor).to_string()))
                .collect(),
        }
    }

    pub fn color(&self, clave: &str) -> &str {
        self.colores
            .get(clave)
            .map(String::as_str)
            .unwrap_or("000000")
    }

    /// Hoja de estilo GTK con la paleta integrada de Rustron.
    pub fn css(&self) -> String {
        let fondo = self.color("surfaceContainerLow");
        let superficie = self.color("surface");
        let texto = self.color("onSurface");
        let texto_suave = self.color("onSurfaceVariant");
        let borde = self.color("outlineVariant");
        let acento = self.color("primary");
        format!(
            "window {{ background-color: transparent; border-radius: 12px; }}
.barra-lateral {{ background-color: alpha(#{fondo}, 0.86); padding: 6px 8px; }}
.contenido {{ background-color: alpha(#{fondo}, 0.86); padding: 8px 8px 8px 0; }}
.tarjeta {{ background-color: #{superficie}; border-radius: 10px; }}
button {{ outline: none; }}
.pill {{ background-color: alpha(#{texto}, 0.10); color: #{texto}; border-radius: 12px; min-height: 36px; padding: 0 10px; }}
.pill:focus-within {{ background-color: alpha(#{texto}, 0.16); box-shadow: inset 0 0 0 1px #{acento}; }}
.pill entry {{ background: none; box-shadow: none; color: #{texto}; }}
.icono {{ color: #{texto_suave}; }}
.acento {{ color: #{acento}; }}
.workspace {{ color: #{texto}; font-weight: 700; font-size: 1.05em; padding: 6px 4px; }}
.separador {{ background-color: alpha(#{borde}, 0.8); min-height: 1px; margin: 6px 4px; }}
.fila {{ color: #{texto}; border-radius: 10px; padding: 8px 10px; background: none; box-shadow: none; }}
.fila:hover {{ background-color: alpha(#{texto}, 0.08); }}
.fila.activa {{ background-color: alpha(#{texto}, 0.14); color: #{texto}; }}
.fila-suave {{ color: #{texto_suave}; }}
.barra-inferior {{ padding: 4px 6px; }}
.boton-icono {{ min-width: 30px; min-height: 30px; border-radius: 8px; background: none; box-shadow: none; color: #{texto_suave}; padding: 0; }}
.boton-icono:hover {{ background-color: alpha(#{texto}, 0.10); color: #{texto}; }}
.boton-icono:disabled {{ opacity: 0.35; }}
"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paleta_integrada_contiene_colores_de_interfaz() {
        let paleta = Paleta::por_defecto();
        assert_eq!(paleta.color("surface"), "1c1c1e");
        assert_eq!(paleta.color("primary"), "ff9f0a");
        assert_eq!(paleta.color("onSurface"), "ffffff");
    }

    #[test]
    fn css_usa_la_paleta_integrada() {
        let css = Paleta::por_defecto().css();
        assert!(css.contains("#ff9f0a"));
        assert!(css.contains(".barra-lateral"));
        assert!(css.contains("alpha(#1c1c1e, 0.86)"));
        assert!(css.contains(".tarjeta"));
    }
}
