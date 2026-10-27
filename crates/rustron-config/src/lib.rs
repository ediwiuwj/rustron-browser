use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub general: General,
    pub adblock: Adblock,
    pub ui: Ui,
    pub tabs: Tabs,
    pub hyprland: Hyprland,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct General {
    pub homepage: String,
    pub search_engine: String,
    pub restore_session: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Adblock {
    pub enabled: bool,
    pub lists: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Ui {
    pub theme: String,
    pub compact_mode: bool,
    pub sidebar_width: u32,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Tabs {
    pub suspend_after_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Hyprland {
    pub force_shm: ForceShm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForceShm {
    Auto,
    Always,
    Never,
}

impl Default for General {
    fn default() -> Self {
        Self {
            homepage: "about:blank".into(),
            search_engine: "https://duckduckgo.com/?q=%s".into(),
            restore_session: true,
        }
    }
}

impl Default for Adblock {
    fn default() -> Self {
        Self {
            enabled: true,
            lists: vec!["easylist".into(), "easyprivacy".into()],
        }
    }
}

impl Default for Ui {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            compact_mode: false,
            sidebar_width: 240,
        }
    }
}

impl Default for Tabs {
    fn default() -> Self {
        Self {
            suspend_after_minutes: 30,
        }
    }
}

impl Default for Hyprland {
    fn default() -> Self {
        Self {
            force_shm: ForceShm::Auto,
        }
    }
}

impl Config {
    pub fn parse(texto: &str) -> Result<Self, String> {
        let config: Config = toml::from_str(texto).map_err(|e| e.to_string())?;
        config.validate()?;
        Ok(config)
    }

    /// Lee la configuración. Si el archivo no existe usa los valores por defecto sin avisar.
    /// Si existe pero no es válido, usa los valores por defecto y devuelve el aviso.
    pub fn load(ruta: &Path) -> (Self, Option<String>) {
        match fs::read_to_string(ruta) {
            Ok(texto) => match Self::parse(&texto) {
                Ok(config) => (config, None),
                Err(error) => (
                    Self::default(),
                    Some(format!(
                        "Configuración inválida en {}: {error}. Se usan valores por defecto.",
                        ruta.display()
                    )),
                ),
            },
            Err(error) if error.kind() == ErrorKind::NotFound => (Self::default(), None),
            Err(error) => (
                Self::default(),
                Some(format!(
                    "No se pudo leer {}: {error}. Se usan valores por defecto.",
                    ruta.display()
                )),
            ),
        }
    }

    fn validate(&self) -> Result<(), String> {
        if !(120..=600).contains(&self.ui.sidebar_width) {
            return Err(format!(
                "ui.sidebar_width debe estar entre 120 y 600 (valor: {})",
                self.ui.sidebar_width
            ));
        }
        if self.tabs.suspend_after_minutes == 0 {
            return Err("tabs.suspend_after_minutes debe ser mayor que 0".into());
        }
        if !self.general.search_engine.contains("%s") {
            return Err("general.search_engine debe contener %s para la búsqueda".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_file_gives_defaults() {
        assert_eq!(Config::parse("").unwrap(), Config::default());
    }

    #[test]
    fn defaults_match_the_plan() {
        let c = Config::default();
        assert_eq!(c.general.homepage, "about:blank");
        assert!(c.general.restore_session);
        assert!(c.adblock.enabled);
        assert_eq!(c.adblock.lists, vec!["easylist", "easyprivacy"]);
        assert_eq!(c.ui.theme, "dark");
        assert_eq!(c.ui.sidebar_width, 240);
        assert_eq!(c.tabs.suspend_after_minutes, 30);
        assert_eq!(c.hyprland.force_shm, ForceShm::Auto);
    }

    #[test]
    fn partial_file_keeps_other_defaults() {
        let c = Config::parse("[ui]\ncompact_mode = true\n").unwrap();
        assert!(c.ui.compact_mode);
        assert_eq!(c.ui.sidebar_width, 240);
        assert!(c.adblock.enabled);
    }

    #[test]
    fn force_shm_accepts_only_known_values() {
        let c = Config::parse("[hyprland]\nforce_shm = \"never\"\n").unwrap();
        assert_eq!(c.hyprland.force_shm, ForceShm::Never);
        assert!(Config::parse("[hyprland]\nforce_shm = \"siempre\"\n").is_err());
    }

    #[test]
    fn wrong_type_reports_location() {
        let error = Config::parse("[ui]\nsidebar_width = \"ancho\"\n").unwrap_err();
        assert!(error.contains("line 2"), "{error}");
    }

    #[test]
    fn unknown_key_is_rejected() {
        assert!(Config::parse("[ui]\nsidebar_widht = 200\n").is_err());
    }

    #[test]
    fn out_of_range_values_are_rejected() {
        assert!(Config::parse("[ui]\nsidebar_width = 50\n").is_err());
        assert!(Config::parse("[tabs]\nsuspend_after_minutes = 0\n").is_err());
        assert!(Config::parse("[general]\nsearch_engine = \"https://x.org/?q=\"\n").is_err());
    }

    #[test]
    fn missing_file_is_silent() {
        let ruta = std::env::temp_dir().join("rustron-no-existe.toml");
        let (config, aviso) = Config::load(&ruta);
        assert_eq!(config, Config::default());
        assert!(aviso.is_none());
    }

    #[test]
    fn invalid_file_falls_back_with_warning() {
        let ruta = std::env::temp_dir().join(format!("rustron-config-{}.toml", std::process::id()));
        fs::write(&ruta, "[ui]\nsidebar_width = 9999\n").unwrap();
        let (config, aviso) = Config::load(&ruta);
        fs::remove_file(&ruta).unwrap();
        assert_eq!(config, Config::default());
        assert!(aviso.unwrap().contains("sidebar_width"));
    }
}
