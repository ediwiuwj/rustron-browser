//! Capa de motor web: WebKitGTK 6.0. Es la única que conoce `webkit6`.

use std::path::Path;

use gtk4::{gio, glib};

use webkit6::prelude::WebViewExt;
pub use webkit6::{LoadEvent, UserContentManager, WebView};

const MANEJADOR_PUENTE: &str = "rustron";

/// Entrega un mensaje JSON a la interfaz: llama a `window.__rustronRecibir(texto)`.
pub fn entregar_a_interfaz(vista: &WebView, mensaje: &str) {
    // Un literal de cadena JSON es también un literal de cadena de JavaScript.
    let literal = serde_json::to_string(mensaje).unwrap_or_else(|_| "\"\"".into());
    let guion = format!("window.__rustronRecibir && window.__rustronRecibir({literal})");
    vista.evaluate_javascript(&guion, None, None, None::<&gio::Cancellable>, |resultado| {
        if let Err(error) = resultado {
            eprintln!("no se pudo entregar un mensaje a la interfaz: {error}");
        }
    });
}

pub struct Motor {
    contenido: UserContentManager,
    almacen: webkit6::UserContentFilterStore,
}

impl Motor {
    pub fn new(directorio_filtros: &Path) -> Self {
        if let Some(sesion) = webkit6::NetworkSession::default()
            && let Some(datos) = sesion.website_data_manager()
        {
            datos.set_favicons_enabled(true);
        }
        let almacen =
            webkit6::UserContentFilterStore::new(directorio_filtros.to_str().unwrap_or("."));
        Self {
            contenido: UserContentManager::new(),
            almacen,
        }
    }

    pub fn nueva_vista(&self) -> WebView {
        WebView::builder()
            .user_content_manager(&self.contenido)
            .build()
    }

    /// Vista de la interfaz de Zen. Tiene su propio `UserContentManager` con el manejador
    /// `rustron`: las pestañas usan otro, así que ninguna página web alcanza el puente.
    /// `al_recibir` recibe cada mensaje que la UI manda con `postMessage` (siempre texto).
    pub fn vista_interfaz(&self, al_recibir: impl Fn(String) + 'static) -> WebView {
        let contenido = UserContentManager::new();
        contenido.register_script_message_handler(MANEJADOR_PUENTE, None);
        contenido.connect_script_message_received(Some(MANEJADOR_PUENTE), move |_, valor| {
            if valor.is_string() {
                al_recibir(valor.to_str().to_string());
            }
        });
        WebView::builder().user_content_manager(&contenido).build()
    }

    /// Compila cada bloque de reglas como un filtro de WebKit y lo añade a todas las vistas.
    pub fn instalar_filtros(&self, bloques: &[String]) {
        for (indice, json) in bloques.iter().enumerate() {
            let contenido = self.contenido.clone();
            let bytes = glib::Bytes::from(json.as_bytes());
            self.almacen.save(
                &format!("rustron-{indice}"),
                &bytes,
                None::<&gio::Cancellable>,
                move |resultado| match resultado {
                    Ok(filtro) => contenido.add_filter(&filtro),
                    Err(error) => eprintln!("filtro de anuncios no compilado: {error}"),
                },
            );
        }
    }
}
