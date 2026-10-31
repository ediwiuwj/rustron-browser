//! Prueba de punta a punta del puente con un WebKit real.
//!
//! Carga una página con el `puente.js` verdadero, recorre el protocolo contra el
//! `rustron-bridge` verdadero y comprueba el resultado. Necesita una pantalla: use
//! `scripts/probar-puente.sh`, que la aísla con Broadway.

use std::cell::{OnceCell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use gtk4::glib;
use gtk4::prelude::*;
use rustron_bridge::{Almacen, Puente};
use rustron_core::{Browser, EngineEvent};
use rustron_engine::{Motor, WebView, entregar_a_interfaz};
use webkit6::prelude::WebViewExt;

const PUENTE_JS: &str = include_str!("../../../shell/shim/puente.js");

const ESCENARIO: &str = r#"
const p = new Puente((t) => window.webkit.messageHandlers.rustron.postMessage(t));
window.__rustronRecibir = (t) => p.recibir(t);
const una_vez = (tipo) => new Promise((r) => { const baja = p.on(tipo, (m) => { baja(); r(m); }); });
(async () => {
  const res = {};
  try {
    const inst = una_vez("instantanea");
    p.conectar();
    await inst;
    res.listo = p.listo;
    res.espacio = p.espacios[0].nombre;

    const creada = una_vez("pestana-creada");
    const activada = una_vez("pestana-activada");
    const titulo = una_vez("pestana-actualizada");
    p.accion("nueva-pestana", { uri: "https://a.com" });
    await creada;
    await activada;
    res.pestanas = p.pestanas.size;
    res.activa_es_la_nueva = p.pestanaActiva === [...p.pestanas.keys()][0];
    res.titulo_del_motor = (await titulo).pestana.titulo;

    await p.peticion("escribir", { ruta: "s/a.json", texto: '{"x":1}' });
    res.leido = await p.peticion("leer", { ruta: "s/a.json" });
    res.inexistente = await p.peticion("leer", { ruta: "s/no.json" });
    try { await p.peticion("leer", { ruta: "../fuera" }); res.fuera = "NO RECHAZADO"; }
    catch (e) { res.fuera = "rechazado"; }
  } catch (e) {
    res.error = String(e);
  }
  window.webkit.messageHandlers.rustron.postMessage(JSON.stringify({ tipo: "prueba-fin", res }));
})();
"#;

fn pagina() -> String {
    let modulo = PUENTE_JS
        .replace("export class", "class")
        .replace("export function", "function");
    format!("<!doctype html><script>{modulo}\n{ESCENARIO}</script>")
}

fn main() {
    gtk4::init().expect("GTK no pudo iniciarse (¿hay pantalla?)");
    let bucle = glib::MainLoop::new(None, false);

    let perfil = std::env::temp_dir().join(format!("rustron-e2e-{}", std::process::id()));
    let almacen = Almacen::new(&perfil);
    let navegador = Rc::new(RefCell::new(Browser::new()));
    let puente = Rc::new(RefCell::new(Puente::new(&navegador.borrow())));
    let vista: Rc<OnceCell<WebView>> = Rc::new(OnceCell::new());
    let resultado: Rc<RefCell<Option<serde_json::Value>>> = Rc::new(RefCell::new(None));

    let motor = Motor::new(&perfil.join("filtros"));
    let al_recibir = {
        let (navegador, puente, vista, resultado, bucle) = (
            navegador.clone(),
            puente.clone(),
            vista.clone(),
            resultado.clone(),
            bucle.clone(),
        );
        move |texto: String| {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&texto)
                && v["tipo"] == "prueba-fin"
            {
                *resultado.borrow_mut() = Some(v["res"].clone());
                bucle.quit();
                return;
            }
            let Some(ui) = vista.get() else { return };
            let entregar =
                |mensajes: &[String]| mensajes.iter().for_each(|m| entregar_a_interfaz(ui, m));

            let mut nav = navegador.borrow_mut();
            let mut puente = puente.borrow_mut();
            match puente.orden(&mut nav, &texto) {
                Err(error) => eprintln!("{error}"),
                Ok(salida) => {
                    entregar(&salida.mensajes);
                    if let Some(p) = salida.peticion {
                        let r = almacen.atender(&p.metodo, &p.args);
                        entregar(&[Puente::respuesta(p.id, r)]);
                    }
                    // El motor reporta el título de la pestaña recién creada.
                    if salida.mensajes.iter().any(|m| m.contains("pestana-creada"))
                        && let Some(tab) = nav.active_tab
                    {
                        let evento = EngineEvent::TitleChanged {
                            tab,
                            title: "Desde el motor".into(),
                        };
                        entregar(&puente.evento_motor(&mut nav, evento).mensajes);
                    }
                }
            }
        }
    };
    let ui = motor.vista_interfaz(al_recibir);
    let ventana = gtk4::Window::builder()
        .default_width(400)
        .default_height(300)
        .build();
    ventana.set_child(Some(&ui));
    ventana.present();
    vista.set(ui.clone()).ok();
    ui.load_html(&pagina(), Some("rustron://interfaz/"));

    glib::timeout_add_local_once(Duration::from_secs(25), {
        let bucle = bucle.clone();
        move || bucle.quit()
    });
    bucle.run();

    let _ = std::fs::remove_dir_all(&perfil);
    let Some(res) = resultado.borrow().clone() else {
        eprintln!("FALLO: la página no terminó el escenario a tiempo");
        std::process::exit(1);
    };
    println!("{}", serde_json::to_string_pretty(&res).unwrap());
    let esperado = res["listo"] == true
        && res["espacio"] == "Space"
        && res["pestanas"] == 1
        && res["activa_es_la_nueva"] == true
        && res["titulo_del_motor"] == "Desde el motor"
        && res["leido"] == "{\"x\":1}"
        && res["inexistente"].is_null()
        && res["fuera"] == "rechazado"
        && res.get("error").is_none();
    if esperado {
        println!("OK");
    } else {
        eprintln!("FALLO: resultado inesperado");
        std::process::exit(1);
    }
}
