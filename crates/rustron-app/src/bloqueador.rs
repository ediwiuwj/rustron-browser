//! Descarga (o lee de la caché) las listas de filtros y las compila en un hilo aparte; el resultado
//! vuelve al hilo de la interfaz, que es quien puede instalarlo en el motor.

use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use gtk4::glib::{self, ControlFlow};

const LISTAS: &[(&str, &str)] = &[
    ("easylist.txt", "https://easylist.to/easylist/easylist.txt"),
    (
        "easyprivacy.txt",
        "https://easylist.to/easylist/easyprivacy.txt",
    ),
];

/// `al_compilar` recibe los bloques de reglas ya compilados, en el hilo principal.
pub fn cargar(carpeta_listas: PathBuf, al_compilar: impl Fn(Vec<String>) + 'static) {
    let (tx, rx) = mpsc::channel::<Result<Vec<String>, String>>();
    std::thread::spawn(move || {
        let _ = fs::create_dir_all(&carpeta_listas);
        let mut textos = Vec::new();
        for (nombre, url) in LISTAS {
            let ruta = carpeta_listas.join(nombre);
            if let Ok(texto) = fs::read_to_string(&ruta) {
                textos.push(texto);
                continue;
            }
            let descarga = ureq::get(url)
                .call()
                .map_err(|e| e.to_string())
                .and_then(|r| r.into_string().map_err(|e| e.to_string()));
            match descarga {
                Ok(texto) => {
                    let _ = fs::write(&ruta, &texto);
                    textos.push(texto);
                }
                Err(error) => eprintln!("no se pudo descargar {url}: {error}"),
            }
        }
        let _ = tx.send(rustron_adblock::compilar(&textos));
    });

    glib::timeout_add_local(Duration::from_millis(250), move || match rx.try_recv() {
        Ok(Ok(bloques)) => {
            al_compilar(bloques);
            ControlFlow::Break
        }
        Ok(Err(error)) => {
            eprintln!("bloqueador de anuncios desactivado: {error}");
            ControlFlow::Break
        }
        Err(mpsc::TryRecvError::Empty) => ControlFlow::Continue,
        Err(mpsc::TryRecvError::Disconnected) => ControlFlow::Break,
    });
}
