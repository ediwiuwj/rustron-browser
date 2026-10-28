//! Capa de motor web: WebKitGTK 6.0. Es la única que conoce `webkit6`.

use std::path::Path;

use gtk4::{gio, glib};

pub use webkit6::{LoadEvent, UserContentManager, WebView};

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
