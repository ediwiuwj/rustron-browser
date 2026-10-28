//! Convierte el esquema de colores dinámico de Caelestia (generado desde el wallpaper)
//! en CSS para GTK4, con el mismo aspecto de barra lateral oscura de Zen.

use std::collections::BTreeMap;

/// Paleta por defecto, usada si el esquema no existe o no es válido.
const POR_DEFECTO: &[(&str, &str)] = &[
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

/// Claves que necesita la hoja de estilo.
const CLAVES: &[&str] = &[
    "surface",
    "surfaceContainerLow",
    "surfaceContainer",
    "surfaceContainerHigh",
    "onSurface",
    "onSurfaceVariant",
    "outlineVariant",
    "primary",
    "onPrimaryContainer",
    "primaryContainer",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paleta {
    colores: BTreeMap<String, String>,
}

impl Paleta {
    pub fn por_defecto() -> Self {
        Self {
            colores: POR_DEFECTO
                .iter()
                .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                .collect(),
        }
    }

    /// Lee el JSON de Caelestia (`{"colours": {"primary": "ff9f0a", ...}}`).
    /// Si falta alguna clave, completa con la paleta por defecto.
    pub fn desde_scheme(texto: &str) -> Result<Self, String> {
        let json: serde_json::Value =
            serde_json::from_str(texto).map_err(|e| format!("esquema inválido: {e}"))?;
        let colours = json
            .get("colours")
            .and_then(|c| c.as_object())
            .ok_or("el esquema no tiene la sección 'colours'")?;
        let mut paleta = Self::por_defecto();
        for clave in CLAVES {
            if let Some(valor) = colours.get(*clave).and_then(|v| v.as_str())
                && valida_hex(valor)
            {
                paleta
                    .colores
                    .insert((*clave).to_string(), valor.to_string());
            }
        }
        Ok(paleta)
    }

    pub fn color(&self, clave: &str) -> &str {
        self.colores
            .get(clave)
            .map(String::as_str)
            .unwrap_or("000000")
    }

    /// Hoja de estilo GTK. La barra lateral es translúcida para dejar ver el wallpaper.
    pub fn css(&self) -> String {
        let fondo = self.color("surfaceContainerLow");
        let contenedor = self.color("surfaceContainer");
        let contenedor_alto = self.color("surfaceContainerHigh");
        let texto = self.color("onSurface");
        let texto_suave = self.color("onSurfaceVariant");
        let borde = self.color("outlineVariant");
        let acento = self.color("primary");
        let activo = self.color("primaryContainer");
        let texto_activo = self.color("onPrimaryContainer");
        format!(
            "window {{ background-color: transparent; border-radius: 12px; }}
.barra-lateral {{ background-color: alpha(#{fondo}, 0.82); padding: 6px 8px; }}
.contenido {{ background-color: alpha(#{fondo}, 0.92); }}
.pill {{ background-color: alpha(#{contenedor}, 0.9); color: #{texto}; border-radius: 12px; min-height: 36px; padding: 0 10px; }}
.pill:focus-within {{ box-shadow: inset 0 0 0 1px #{acento}; }}
.pill entry {{ background: none; box-shadow: none; color: #{texto}; }}
.icono {{ color: #{texto_suave}; }}
.acento {{ color: #{acento}; }}
.workspace {{ color: #{texto}; font-weight: 700; font-size: 1.05em; padding: 6px 4px; }}
.separador {{ background-color: #{borde}; min-height: 1px; margin: 6px 4px; }}
.fila {{ color: #{texto}; border-radius: 10px; padding: 8px 10px; background: none; }}
.fila:hover {{ background-color: #{contenedor_alto}; }}
.fila.activa {{ background-color: #{activo}; color: #{texto_activo}; }}
.fila-suave {{ color: #{texto_suave}; }}
.barra-inferior {{ padding: 4px 6px; }}
.boton-icono {{ min-width: 30px; min-height: 30px; border-radius: 8px; background: none; color: #{texto_suave}; padding: 0; }}
.boton-icono:hover {{ background-color: #{contenedor_alto}; color: #{texto}; }}
.boton-icono:disabled {{ opacity: 0.35; }}
"
        )
    }
}

fn valida_hex(valor: &str) -> bool {
    valor.len() == 6 && valor.chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ESQUEMA: &str = r#"{"name":"dynamic","colours":{"primary":"ff9f0a","surfaceContainerLow":"1c1c1e","onSurface":"ffffff"}}"#;

    #[test]
    fn reads_colours_from_scheme() {
        let paleta = Paleta::desde_scheme(ESQUEMA).unwrap();
        assert_eq!(paleta.color("primary"), "ff9f0a");
        assert_eq!(paleta.color("onSurface"), "ffffff");
    }

    #[test]
    fn missing_keys_fall_back_to_defaults() {
        let paleta = Paleta::desde_scheme(ESQUEMA).unwrap();
        assert_eq!(paleta.color("surfaceContainer"), "2c2c2e");
    }

    #[test]
    fn invalid_hex_is_ignored() {
        let paleta = Paleta::desde_scheme(r#"{"colours":{"primary":"zzz"}}"#).unwrap();
        assert_eq!(paleta.color("primary"), "ff9f0a");
    }

    #[test]
    fn invalid_json_is_an_error() {
        assert!(Paleta::desde_scheme("{no es json").is_err());
        assert!(Paleta::desde_scheme(r#"{"otro":1}"#).is_err());
    }

    #[test]
    fn css_uses_the_palette() {
        let css = Paleta::por_defecto().css();
        assert!(css.contains("#ff9f0a"));
        assert!(css.contains(".barra-lateral"));
        assert!(css.contains("alpha(#1c1c1e, 0.82)"));
    }
}
