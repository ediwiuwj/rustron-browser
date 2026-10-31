//! Foto del estado del navegador que ve la UI, y la diferencia entre dos fotos.

use rustron_core::Browser;
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PestanaDto {
    pub id: u64,
    pub titulo: String,
    pub uri: String,
    pub cargando: bool,
    pub fijada: bool,
    pub espacio: Option<u64>,
    pub icono: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EspacioDto {
    pub id: u64,
    pub nombre: String,
    pub pestanas: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Instantanea {
    pub espacios: Vec<EspacioDto>,
    pub pestanas: Vec<PestanaDto>,
    pub espacio_activo: u64,
    pub pestana_activa: Option<u64>,
    pub barra_visible: bool,
    pub compacto: bool,
    pub barra_url_abierta: bool,
}

impl Instantanea {
    pub fn de(navegador: &Browser) -> Self {
        let espacio_de = |id| {
            navegador
                .workspaces
                .iter()
                .find(|ws| ws.tabs.contains(&id))
                .map(|ws| ws.id.0)
        };
        Self {
            espacios: navegador
                .workspaces
                .iter()
                .map(|ws| EspacioDto {
                    id: ws.id.0,
                    nombre: ws.name.clone(),
                    pestanas: ws.tabs.iter().map(|t| t.0).collect(),
                })
                .collect(),
            pestanas: navegador
                .tabs
                .iter()
                .map(|t| PestanaDto {
                    id: t.id.0,
                    titulo: t.title.clone(),
                    uri: t.uri.clone(),
                    cargando: t.loading,
                    fijada: t.pinned,
                    espacio: espacio_de(t.id),
                    icono: t.icon.clone(),
                })
                .collect(),
            espacio_activo: navegador.active_workspace.0,
            pestana_activa: navegador.active_tab.map(|t| t.0),
            barra_visible: navegador.sidebar_visible,
            compacto: navegador.compact,
            barra_url_abierta: navegador.url_bar_open,
        }
    }
}

/// Eventos (tipo, datos) que llevan de `antes` a `despues`, en un orden que la UI puede
/// aplicar sin referencias colgantes: cierres, altas, cambios, espacios, activaciones.
pub(crate) fn diferencias(
    antes: &Instantanea,
    despues: &Instantanea,
) -> Vec<(&'static str, Value)> {
    let mut eventos = Vec::new();

    for vieja in &antes.pestanas {
        if !despues.pestanas.iter().any(|p| p.id == vieja.id) {
            eventos.push(("pestana-cerrada", json!({ "id": vieja.id })));
        }
    }
    for nueva in &despues.pestanas {
        match antes.pestanas.iter().find(|p| p.id == nueva.id) {
            None => eventos.push(("pestana-creada", json!({ "pestana": nueva }))),
            Some(vieja) if vieja != nueva => {
                eventos.push(("pestana-actualizada", json!({ "pestana": nueva })));
            }
            Some(_) => {}
        }
    }
    if antes.espacios != despues.espacios {
        eventos.push(("espacios", json!({ "espacios": despues.espacios })));
    }
    if antes.espacio_activo != despues.espacio_activo {
        eventos.push(("espacio-activado", json!({ "id": despues.espacio_activo })));
    }
    if antes.pestana_activa != despues.pestana_activa {
        eventos.push(("pestana-activada", json!({ "id": despues.pestana_activa })));
    }
    if (antes.barra_visible, antes.compacto, antes.barra_url_abierta)
        != (
            despues.barra_visible,
            despues.compacto,
            despues.barra_url_abierta,
        )
    {
        eventos.push((
            "interfaz",
            json!({
                "barraVisible": despues.barra_visible,
                "compacto": despues.compacto,
                "barraUrlAbierta": despues.barra_url_abierta,
            }),
        ));
    }
    eventos
}
