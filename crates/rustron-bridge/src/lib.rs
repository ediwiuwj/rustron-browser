//! Puente entre la interfaz de Zen (un WebView) y `rustron-core`.
//!
//! La UI manda órdenes en JSON; el puente las convierte en `Action`. Cada cambio del
//! navegador, venga de la UI o del motor, se compara con el estado anterior y llega a
//! la UI como eventos mínimos. Aquí no hay GTK: el transporte lo pone `rustron-app`.

mod estado;
mod orden;
mod servicios;

pub use estado::{EspacioDto, Instantanea, PestanaDto};
pub use orden::{ErrorPuente, Peticion};
pub use servicios::Almacen;

use rustron_core::{Browser, Effect, EngineEvent};
use serde_json::{Value, json};

/// Resultado de procesar un mensaje.
#[derive(Debug, Default, PartialEq)]
pub struct Salida {
    /// Órdenes para el motor web y los servicios.
    pub efectos: Vec<Effect>,
    /// Mensajes JSON que hay que entregar a la UI, en orden.
    pub mensajes: Vec<String>,
    /// Petición con respuesta pendiente; contéstese con `Puente::respuesta`.
    pub peticion: Option<Peticion>,
}

pub struct Puente {
    previa: Instantanea,
}

impl Puente {
    pub fn new(navegador: &Browser) -> Self {
        Self {
            previa: Instantanea::de(navegador),
        }
    }

    /// Procesa un mensaje de la UI.
    pub fn orden(&mut self, navegador: &mut Browser, json: &str) -> Result<Salida, ErrorPuente> {
        let mut salida = Salida::default();
        match orden::interpretar(json)? {
            orden::Orden::Listo => {
                self.previa = Instantanea::de(navegador);
                salida
                    .mensajes
                    .push(mensaje("instantanea", json!({ "estado": self.previa })));
            }
            orden::Orden::Accion { accion } => {
                salida.efectos = navegador.dispatch(accion.a_accion());
                salida.mensajes = self.diferencias(navegador);
            }
            orden::Orden::Peticion { id, metodo, args } => {
                salida.peticion = Some(Peticion { id, metodo, args });
            }
        }
        Ok(salida)
    }

    /// Aplica un cambio que reporta el motor web (título, URL, carga, cierre).
    pub fn evento_motor(&mut self, navegador: &mut Browser, evento: EngineEvent) -> Salida {
        navegador.apply_event(evento);
        Salida {
            mensajes: self.diferencias(navegador),
            ..Salida::default()
        }
    }

    /// Mensaje de respuesta a una petición.
    pub fn respuesta(id: u64, resultado: Result<Value, String>) -> String {
        match resultado {
            Ok(valor) => mensaje("respuesta", json!({ "id": id, "ok": true, "valor": valor })),
            Err(error) => mensaje(
                "respuesta",
                json!({ "id": id, "ok": false, "error": error }),
            ),
        }
    }

    /// Eventos que llevan a la UI del estado anterior al actual.
    fn diferencias(&mut self, navegador: &Browser) -> Vec<String> {
        let actual = Instantanea::de(navegador);
        let eventos = estado::diferencias(&self.previa, &actual)
            .into_iter()
            .map(|(tipo, datos)| mensaje(tipo, datos))
            .collect();
        self.previa = actual;
        eventos
    }
}

fn mensaje(tipo: &str, datos: Value) -> String {
    let mut objeto = match datos {
        Value::Object(mapa) => mapa,
        otro => serde_json::Map::from_iter([("valor".to_string(), otro)]),
    };
    objeto.insert("tipo".into(), Value::String(tipo.into()));
    Value::Object(objeto).to_string()
}
