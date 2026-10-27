//! Genera `user.js` para Zen (Firefox) a partir de un TOML con claves amigables.
//!
//! Solo se escriben los ajustes que el usuario define. Lo demás conserva los
//! valores por defecto de Zen. El archivo escrito lleva una marca, y nunca se
//! sobrescribe un `user.js` que no tenga esa marca.

use std::fs;
use std::path::{Path, PathBuf};

pub const MARCA: &str = "// rustron-prefs: archivo gestionado, no editar a mano";
const NOMBRE_USER_JS: &str = "user.js";
const NOMBRE_TEMPORAL: &str = "user.js.rustron-tmp";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tipo {
    Bool,
    Int,
    Str,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Valor {
    Bool(bool),
    Int(i64),
    Str(String),
}

pub struct Ajuste {
    pub clave: &'static str,
    pub pref: &'static str,
    pub tipo: Tipo,
    pub por_defecto: &'static str,
    pub descripcion: &'static str,
}

pub const CATALOGO: &[Ajuste] = &[
    Ajuste {
        clave: "tabs.vertical",
        pref: "zen.tabs.vertical",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Pestañas verticales",
    },
    Ajuste {
        clave: "tabs.vertical_right",
        pref: "zen.tabs.vertical.right-side",
        tipo: Tipo::Bool,
        por_defecto: "false",
        descripcion: "Barra de pestañas a la derecha",
    },
    Ajuste {
        clave: "tabs.show_newtab_vertical",
        pref: "zen.tabs.show-newtab-vertical",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Botón de nueva pestaña en vertical",
    },
    Ajuste {
        clave: "tabs.essentials_max",
        pref: "zen.tabs.essentials.max",
        tipo: Tipo::Int,
        por_defecto: "12",
        descripcion: "Máximo de pestañas esenciales",
    },
    Ajuste {
        clave: "tabs.rename",
        pref: "zen.tabs.rename-tabs",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Permitir renombrar pestañas",
    },
    Ajuste {
        clave: "tabs.open_pinned_in_new_tab",
        pref: "zen.tabs.open-pinned-in-new-tab",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Abrir pestañas fijadas en nueva pestaña",
    },
    Ajuste {
        clave: "tabs.select_recent_on_close",
        pref: "zen.tabs.select-recently-used-on-close",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Al cerrar, seleccionar la usada recientemente",
    },
    Ajuste {
        clave: "tabs.close_window_with_empty",
        pref: "zen.tabs.close-window-with-empty",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Cerrar la ventana si queda vacía",
    },
    Ajuste {
        clave: "theme.accent_color",
        pref: "zen.theme.accent-color",
        tipo: Tipo::Str,
        por_defecto: "AccentColor",
        descripcion: "Color de acento",
    },
    Ajuste {
        clave: "theme.border_radius",
        pref: "zen.theme.border-radius",
        tipo: Tipo::Int,
        por_defecto: "-1",
        descripcion: "Radio de bordes (-1 = automático)",
    },
    Ajuste {
        clave: "theme.content_separation",
        pref: "zen.theme.content-element-separation",
        tipo: Tipo::Int,
        por_defecto: "8",
        descripcion: "Separación entre elementos (px)",
    },
    Ajuste {
        clave: "theme.use_system_colors",
        pref: "zen.theme.use-system-colors",
        tipo: Tipo::Bool,
        por_defecto: "false",
        descripcion: "Usar colores del sistema",
    },
    Ajuste {
        clave: "theme.acrylic_sidebar",
        pref: "zen.theme.acrylic-sidebar",
        tipo: Tipo::Bool,
        por_defecto: "false",
        descripcion: "Barra lateral acrílica",
    },
    Ajuste {
        clave: "theme.acrylic_urlbar",
        pref: "zen.theme.acrylic-urlbar",
        tipo: Tipo::Bool,
        por_defecto: "false",
        descripcion: "Barra de URL acrílica",
    },
    Ajuste {
        clave: "theme.hide_tab_throbber",
        pref: "zen.theme.hide-tab-throbber",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Ocultar indicador de carga en pestañas",
    },
    Ajuste {
        clave: "theme.hide_unified_extensions_button",
        pref: "zen.theme.hide-unified-extensions-button",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Ocultar botón de extensiones",
    },
    Ajuste {
        clave: "theme.essentials_favicon_bg",
        pref: "zen.theme.essentials-favicon-bg",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Fondo en iconos de esenciales",
    },
    Ajuste {
        clave: "compact.hide_tabbar",
        pref: "zen.view.compact.hide-tabbar",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Modo compacto: ocultar barra de pestañas",
    },
    Ajuste {
        clave: "compact.hide_toolbar",
        pref: "zen.view.compact.hide-toolbar",
        tipo: Tipo::Bool,
        por_defecto: "false",
        descripcion: "Modo compacto: ocultar barra de herramientas",
    },
    Ajuste {
        clave: "compact.animate_sidebar",
        pref: "zen.view.compact.animate-sidebar",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Animar la barra lateral",
    },
    Ajuste {
        clave: "compact.show_on_hover",
        pref: "zen.view.compact.show-sidebar-and-toolbar-on-hover",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Mostrar barras al pasar el mouse",
    },
    Ajuste {
        clave: "compact.hide_after_hover_ms",
        pref: "zen.view.compact.toolbar-hide-after-hover.duration",
        tipo: Tipo::Int,
        por_defecto: "1000",
        descripcion: "Milisegundos antes de ocultar la barra",
    },
    Ajuste {
        clave: "urlbar.behavior",
        pref: "zen.urlbar.behavior",
        tipo: Tipo::Str,
        por_defecto: "floating-on-type",
        descripcion: "Comportamiento de la barra de URL",
    },
    Ajuste {
        clave: "urlbar.show_pinned",
        pref: "zen.urlbar.show-pinned",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Mostrar fijadas en la barra de URL",
    },
    Ajuste {
        clave: "urlbar.show_sponsored",
        pref: "zen.urlbar.show-sponsored",
        tipo: Tipo::Bool,
        por_defecto: "false",
        descripcion: "Mostrar sugerencias patrocinadas",
    },
    Ajuste {
        clave: "urlbar.show_protections_icon",
        pref: "zen.urlbar.show-protections-icon",
        tipo: Tipo::Bool,
        por_defecto: "false",
        descripcion: "Mostrar icono de protecciones",
    },
    Ajuste {
        clave: "glance.enabled",
        pref: "zen.glance.enabled",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Vista rápida (Glance)",
    },
    Ajuste {
        clave: "glance.activation_method",
        pref: "zen.glance.activation-method",
        tipo: Tipo::Str,
        por_defecto: "alt",
        descripcion: "Tecla para activar Glance",
    },
    Ajuste {
        clave: "view.sidebar_draggable",
        pref: "zen.view.draggable-sidebar",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Barra lateral arrastrable",
    },
    Ajuste {
        clave: "view.loading_indicator",
        pref: "zen.view.enable-loading-indicator",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Indicador de carga",
    },
    Ajuste {
        clave: "view.hide_window_controls",
        pref: "zen.view.hide-window-controls",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Ocultar controles de ventana",
    },
    Ajuste {
        clave: "view.grey_inactive_windows",
        pref: "zen.view.grey-out-inactive-windows",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Atenuar ventanas inactivas",
    },
    Ajuste {
        clave: "view.show_clear_tabs_button",
        pref: "zen.view.show-clear-tabs-button",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Botón para limpiar pestañas",
    },
    Ajuste {
        clave: "mods.auto_update",
        pref: "zen.mods.auto-update",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Actualizar mods automáticamente",
    },
    Ajuste {
        clave: "mods.auto_update_days",
        pref: "zen.mods.auto-update-days",
        tipo: Tipo::Int,
        por_defecto: "20",
        descripcion: "Días entre actualizaciones de mods",
    },
    Ajuste {
        clave: "startup.smooth_scroll_tabs",
        pref: "zen.startup.smooth-scroll-in-tabs",
        tipo: Tipo::Bool,
        por_defecto: "true",
        descripcion: "Desplazamiento suave en pestañas",
    },
];

impl Valor {
    fn desde_toml(tipo: Tipo, valor: &toml::Value) -> Result<Self, String> {
        match (tipo, valor) {
            (Tipo::Bool, toml::Value::Boolean(b)) => Ok(Valor::Bool(*b)),
            (Tipo::Int, toml::Value::Integer(i)) => Ok(Valor::Int(*i)),
            (Tipo::Str, toml::Value::String(s)) => Ok(Valor::Str(s.clone())),
            (esperado, _) => Err(format!("se esperaba {}", nombre_tipo(esperado))),
        }
    }

    fn a_js(&self) -> String {
        match self {
            Valor::Bool(b) => b.to_string(),
            Valor::Int(i) => i.to_string(),
            Valor::Str(s) => format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")),
        }
    }
}

fn nombre_tipo(tipo: Tipo) -> &'static str {
    match tipo {
        Tipo::Bool => "true o false",
        Tipo::Int => "un número entero",
        Tipo::Str => "un texto",
    }
}

#[derive(Debug, Default, PartialEq)]
pub struct Ajustes {
    valores: Vec<(&'static str, &'static str, Valor)>,
}

impl Ajustes {
    pub fn parse(texto: &str) -> Result<Self, String> {
        let tabla: toml::Table = texto.parse().map_err(|e| format!("TOML inválido: {e}"))?;
        let mut valores = Vec::new();
        for (seccion, contenido) in &tabla {
            let subtabla = contenido
                .as_table()
                .ok_or_else(|| format!("'{seccion}' debe ser una sección [{seccion}]"))?;
            for (clave, valor) in subtabla {
                let completa = format!("{seccion}.{clave}");
                let ajuste = CATALOGO
                    .iter()
                    .find(|a| a.clave == completa)
                    .ok_or_else(|| format!("clave desconocida: {completa}"))?;
                let valor = Valor::desde_toml(ajuste.tipo, valor)
                    .map_err(|e| format!("{completa}: {e}"))?;
                valores.push((ajuste.clave, ajuste.pref, valor));
            }
        }
        valores.sort_by_key(|(_, pref, _)| *pref);
        Ok(Self { valores })
    }

    pub fn len(&self) -> usize {
        self.valores.len()
    }

    pub fn is_empty(&self) -> bool {
        self.valores.is_empty()
    }
}

pub fn render(ajustes: &Ajustes) -> String {
    let mut salida = String::from(MARCA);
    salida.push('\n');
    for (_, pref, valor) in &ajustes.valores {
        salida.push_str(&format!("user_pref(\"{pref}\", {});\n", valor.a_js()));
    }
    salida
}

pub fn apply(ajustes: &Ajustes, perfil: &Path) -> Result<PathBuf, String> {
    if !perfil.is_dir() {
        return Err(format!("El perfil no existe: {}", perfil.display()));
    }
    let destino = perfil.join(NOMBRE_USER_JS);
    if destino.exists() {
        let actual = fs::read_to_string(&destino)
            .map_err(|e| format!("No se pudo leer {}: {e}", destino.display()))?;
        if !actual.contains(MARCA) {
            return Err(format!(
                "{} ya existe y no lo creó rustron-prefs. No lo sobrescribo.",
                destino.display()
            ));
        }
    }
    let temporal = perfil.join(NOMBRE_TEMPORAL);
    fs::write(&temporal, render(ajustes))
        .map_err(|e| format!("No se pudo escribir {}: {e}", temporal.display()))?;
    fs::rename(&temporal, &destino)
        .map_err(|e| format!("No se pudo reemplazar {}: {e}", destino.display()))?;
    Ok(destino)
}

pub fn listar() -> String {
    let mut salida = String::new();
    for ajuste in CATALOGO {
        salida.push_str(&format!(
            "{:<38} {:<46} {:<6} por defecto: {:<18} {}\n",
            ajuste.clave,
            ajuste.pref,
            nombre_corto(ajuste.tipo),
            ajuste.por_defecto,
            ajuste.descripcion
        ));
    }
    salida
}

fn nombre_corto(tipo: Tipo) -> &'static str {
    match tipo {
        Tipo::Bool => "bool",
        Tipo::Int => "int",
        Tipo::Str => "texto",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporal(nombre: &str) -> PathBuf {
        let ruta =
            std::env::temp_dir().join(format!("rustron-prefs-{nombre}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&ruta);
        fs::create_dir_all(&ruta).unwrap();
        ruta
    }

    #[test]
    fn empty_config_renders_only_the_marker() {
        let ajustes = Ajustes::parse("").unwrap();
        assert!(ajustes.is_empty());
        assert_eq!(render(&ajustes), format!("{MARCA}\n"));
    }

    #[test]
    fn renders_user_pref_lines_sorted_by_pref_name() {
        let ajustes = Ajustes::parse(
            "[tabs]\nvertical = false\n\n[theme]\naccent_color = \"Rojo\"\nborder_radius = 4\n",
        )
        .unwrap();
        let js = render(&ajustes);
        assert!(js.contains("user_pref(\"zen.tabs.vertical\", false);"));
        assert!(js.contains("user_pref(\"zen.theme.accent-color\", \"Rojo\");"));
        assert!(js.contains("user_pref(\"zen.theme.border-radius\", 4);"));
        let posiciones: Vec<_> = [
            "zen.tabs.vertical\"",
            "zen.theme.accent-color",
            "zen.theme.border-radius",
        ]
        .iter()
        .map(|p| js.find(p).unwrap())
        .collect();
        assert!(posiciones.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn unknown_key_is_rejected() {
        let error = Ajustes::parse("[tabs]\nvertcal = true\n").unwrap_err();
        assert!(error.contains("tabs.vertcal"), "{error}");
    }

    #[test]
    fn wrong_type_is_rejected() {
        let error = Ajustes::parse("[tabs]\nvertical = \"si\"\n").unwrap_err();
        assert!(error.contains("tabs.vertical"), "{error}");
        assert!(Ajustes::parse("[theme]\nborder_radius = true\n").is_err());
    }

    #[test]
    fn section_must_be_a_table() {
        assert!(Ajustes::parse("tabs = true\n").is_err());
    }

    #[test]
    fn strings_are_escaped() {
        let ajustes = Ajustes::parse("[theme]\naccent_color = \"a\\\"b\\\\c\"\n").unwrap();
        assert!(render(&ajustes).contains("\"a\\\"b\\\\c\""));
    }

    #[test]
    fn apply_writes_user_js_and_overwrites_our_own() {
        let perfil = temporal("escribe");
        let uno = Ajustes::parse("[tabs]\nvertical = false\n").unwrap();
        let destino = apply(&uno, &perfil).unwrap();
        assert!(
            fs::read_to_string(&destino)
                .unwrap()
                .contains("zen.tabs.vertical\", false")
        );

        let dos = Ajustes::parse("[tabs]\nvertical = true\n").unwrap();
        apply(&dos, &perfil).unwrap();
        assert!(
            fs::read_to_string(&destino)
                .unwrap()
                .contains("zen.tabs.vertical\", true")
        );
        assert!(!perfil.join(NOMBRE_TEMPORAL).exists());
        fs::remove_dir_all(&perfil).unwrap();
    }

    #[test]
    fn apply_refuses_foreign_user_js() {
        let perfil = temporal("ajeno");
        fs::write(perfil.join(NOMBRE_USER_JS), "user_pref(\"algo\", 1);\n").unwrap();
        let ajustes = Ajustes::parse("[tabs]\nvertical = true\n").unwrap();
        assert!(apply(&ajustes, &perfil).is_err());
        assert_eq!(
            fs::read_to_string(perfil.join(NOMBRE_USER_JS)).unwrap(),
            "user_pref(\"algo\", 1);\n"
        );
        fs::remove_dir_all(&perfil).unwrap();
    }

    #[test]
    fn apply_requires_existing_directory() {
        let ajustes = Ajustes::default();
        let ruta = std::env::temp_dir().join("rustron-prefs-no-existe-xyz");
        let _ = fs::remove_dir_all(&ruta);
        assert!(apply(&ajustes, &ruta).is_err());
    }

    #[test]
    fn catalog_defaults_match_zen_types() {
        for ajuste in CATALOGO {
            let valido = match ajuste.tipo {
                Tipo::Bool => ajuste.por_defecto == "true" || ajuste.por_defecto == "false",
                Tipo::Int => ajuste.por_defecto.parse::<i64>().is_ok(),
                Tipo::Str => true,
            };
            assert!(
                valido,
                "{} tiene un default que no coincide con su tipo",
                ajuste.clave
            );
        }
    }
}
