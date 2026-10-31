//! Mensajes que llegan de la UI.

use rustron_core::{Action, TabId, WorkspaceId};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, PartialEq)]
pub struct ErrorPuente(pub String);

impl std::fmt::Display for ErrorPuente {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "mensaje de la UI inválido: {}", self.0)
    }
}

impl std::error::Error for ErrorPuente {}

#[derive(Debug, PartialEq)]
pub struct Peticion {
    pub id: u64,
    pub metodo: String,
    pub args: Value,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "tipo", rename_all = "kebab-case")]
pub(crate) enum Orden {
    Listo,
    Accion {
        accion: AccionJson,
    },
    Peticion {
        id: u64,
        metodo: String,
        #[serde(default)]
        args: Value,
    },
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "nombre",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum AccionJson {
    NuevaPestana {
        uri: Option<String>,
        espacio: Option<u64>,
    },
    CerrarPestana {
        pestana: u64,
    },
    ActivarPestana {
        pestana: u64,
    },
    Navegar {
        pestana: u64,
        texto: String,
    },
    Recargar {
        pestana: u64,
        #[serde(default)]
        forzar: bool,
    },
    Atras {
        pestana: u64,
    },
    Adelante {
        pestana: u64,
    },
    CambiarEspacio {
        espacio: u64,
    },
    MoverPestana {
        pestana: u64,
        a: u64,
    },
    AlternarBarra,
    AlternarCompacto,
    AlternarAdblock {
        sitio: Option<String>,
    },
    AbrirBarraUrl,
}

impl AccionJson {
    pub(crate) fn a_accion(self) -> Action {
        match self {
            Self::NuevaPestana { uri, espacio } => Action::NewTab {
                uri,
                workspace: espacio.map(WorkspaceId),
            },
            Self::CerrarPestana { pestana } => Action::CloseTab(TabId(pestana)),
            Self::ActivarPestana { pestana } => Action::ActivateTab(TabId(pestana)),
            Self::Navegar { pestana, texto } => Action::Navigate {
                tab: TabId(pestana),
                input: texto,
            },
            Self::Recargar { pestana, forzar } => Action::Reload {
                tab: TabId(pestana),
                hard: forzar,
            },
            Self::Atras { pestana } => Action::GoBack(TabId(pestana)),
            Self::Adelante { pestana } => Action::GoForward(TabId(pestana)),
            Self::CambiarEspacio { espacio } => Action::SwitchWorkspace(WorkspaceId(espacio)),
            Self::MoverPestana { pestana, a } => Action::MoveTab {
                tab: TabId(pestana),
                to: WorkspaceId(a),
            },
            Self::AlternarBarra => Action::ToggleSidebar,
            Self::AlternarCompacto => Action::ToggleCompact,
            Self::AlternarAdblock { sitio } => Action::ToggleAdblock { site: sitio },
            Self::AbrirBarraUrl => Action::OpenUrlBar,
        }
    }
}

pub(crate) fn interpretar(json: &str) -> Result<Orden, ErrorPuente> {
    serde_json::from_str(json).map_err(|e| ErrorPuente(e.to_string()))
}
