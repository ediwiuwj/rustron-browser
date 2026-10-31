//! Modo predeterminado: la ventana es la interfaz de Zen (un WebView) conectada al puente real.
//!
//! Rust manda: la interfaz envía acciones por el puente, `rustron-core` decide, y la interfaz solo
//! cambia cuando llegan los eventos. Las pestañas web son vistas de WebKit colocadas encima del
//! área de contenido que la interfaz reserva (la interfaz avisa de su rectángulo con `area-contenido`).
//! La interfaz y las pestañas usan `UserContentManager` distintos: ninguna página web alcanza el puente.

use std::cell::{Cell, OnceCell, RefCell};
use std::collections::HashMap;
use std::fs;
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::rc::Rc;
use std::time::Duration;

use gtk4::glib;
use gtk4::prelude::*;
use rustron_bridge::{Almacen, Puente, Salida};
use rustron_config::Config;
use rustron_core::{Action, Browser, Effect, EngineEvent, TabId};
use rustron_engine::{LoadEvent, Motor, WebView, entregar_a_interfaz};
use serde_json::{Value, json};
use webkit6::prelude::*;

const INSTALACION_POR_DEFECTO: &str = "/opt/zen-browser-bin";

struct Zen {
    navegador: RefCell<Browser>,
    puente: RefCell<Puente>,
    motor: Motor,
    vistas: RefCell<HashMap<TabId, WebView>>,
    pila: gtk4::Stack,
    superposicion: gtk4::Overlay,
    /// Rectángulo (x, y, ancho, alto) de la pila sobre la interfaz, el que fija `area-contenido`.
    area: Cell<(i32, i32, i32, i32)>,
    /// La vista web está congelada (oculta; la interfaz muestra una imagen suya) porque un menú la cubre.
    congelada: Cell<bool>,
    interfaz: OnceCell<WebView>,
    ventana: OnceCell<gtk4::ApplicationWindow>,
    aplicacion: gtk4::Application,
    /// Atajos de teclado de la interfaz (los `<key>` de Zen); Rust los vigila con el foco en una página web.
    atajos: RefCell<Vec<Atajo>>,
    estilo: gtk4::CssProvider,
    almacen: Almacen,
    config: Config,
}

/// Servidor de la interfaz (hoy `scripts/servir-zen.py`); se detiene al soltarlo.
struct Servidor(Child);

impl Drop for Servidor {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub fn construir(app: &gtk4::Application, inicio: Option<String>) {
    let datos = glib::user_data_dir().join("rustron");
    let (config, aviso) = Config::load(&glib::user_config_dir().join("rustron/config.toml"));
    if let Some(aviso) = aviso {
        eprintln!("{aviso}");
    }
    let (servidor, puerto) = match arrancar_servidor(&datos) {
        Ok(listo) => listo,
        Err(error) => {
            eprintln!("rustron: {error}");
            std::process::exit(1);
        }
    };
    let servidor = Rc::new(RefCell::new(Some(servidor)));

    // La pestaña inicial existe antes de que la interfaz pida la instantánea.
    let mut navegador = Browser::new();
    let uri = inicio.unwrap_or_else(|| config.general.homepage.clone());
    navegador.dispatch(Action::NewTab {
        uri: Some(uri),
        workspace: None,
    });
    let puente = Puente::new(&navegador);

    let pila = gtk4::Stack::new();
    pila.set_overflow(gtk4::Overflow::Hidden); // recorta las vistas a las esquinas redondeadas
    pila.set_visible(false); // hasta saber dónde va

    let zen = Rc::new(Zen {
        navegador: RefCell::new(navegador),
        puente: RefCell::new(puente),
        motor: Motor::new(&datos.join("filtros")),
        vistas: RefCell::new(HashMap::new()),
        pila: pila.clone(),
        superposicion: gtk4::Overlay::new(),
        area: Cell::new((0, 0, 0, 0)),
        congelada: Cell::new(false),
        interfaz: OnceCell::new(),
        ventana: OnceCell::new(),
        aplicacion: app.clone(),
        atajos: RefCell::new(Vec::new()),
        estilo: gtk4::CssProvider::new(),
        almacen: Almacen::new(datos.join("perfil")),
        config,
    });

    let interfaz = {
        let zen = zen.clone();
        zen.clone()
            .motor
            .vista_interfaz(move |texto| al_recibir(&zen, &texto))
    };
    zen.interfaz.set(interfaz.clone()).ok();
    limitar_navegacion(&interfaz, puerto);
    sincronizar_vistas(&zen);

    let superposicion = zen.superposicion.clone();
    superposicion.set_child(Some(&interfaz));
    superposicion.add_overlay(&pila);
    superposicion.set_clip_overlay(&pila, true);
    {
        // La pila ocupa exactamente el rectángulo que reserva la interfaz (un `width_request` es solo un
        // mínimo y la vista web desbordaría).
        let zen = zen.clone();
        superposicion.connect_get_child_position(move |_, _| {
            let (x, y, ancho, alto) = zen.area.get();
            Some(gtk4::gdk::Rectangle::new(x, y, ancho, alto))
        });
    }
    let ventana = gtk4::ApplicationWindow::builder()
        .application(app)
        .title("Rustron")
        .default_width(1200)
        .default_height(760)
        .child(&superposicion)
        .build();
    // El servidor se detiene al cerrar la ventana y también al salir por otra vía (`app.quit()`).
    {
        let servidor = servidor.clone();
        app.connect_shutdown(move |_| {
            servidor.borrow_mut().take();
        });
    }
    zen.ventana.set(ventana.clone()).ok();
    actualizar_titulo(&zen);
    gtk4::style_context_add_provider_for_display(
        &gtk4::prelude::WidgetExt::display(&ventana),
        &zen.estilo,
        gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
    pila.add_css_class("contenido-zen");
    vigilar_teclas(&zen);
    if zen.config.adblock.enabled {
        let zen = zen.clone();
        crate::bloqueador::cargar(datos.join("listas"), move |bloques| {
            zen.motor.instalar_filtros(&bloques);
        });
    }
    ventana.connect_close_request(move |_| {
        servidor.borrow_mut().take();
        glib::Propagation::Proceed
    });
    interfaz.load_uri(&format!("http://127.0.0.1:{puerto}/ui.xhtml"));
    ventana.present();
    if let Some(ruta) = std::env::var_os("RUSTRON_CAPTURA") {
        capturar_y_salir(&ventana, PathBuf::from(ruta), app, &interfaz);
    }
}

/// Diagnóstico: guarda la ventana entera (interfaz y pestañas) en un PNG y cierra la aplicación.
/// `RUSTRON_CAPTURA=ruta.png`; `RUSTRON_CAPTURA_SEGUNDOS` (20 por defecto) es la espera;
/// `RUSTRON_SONDA=archivo.js` evalúa ese JS en la interfaz y muestra su resultado antes de capturar.
fn capturar_y_salir(
    ventana: &gtk4::ApplicationWindow,
    ruta: PathBuf,
    app: &gtk4::Application,
    interfaz: &WebView,
) {
    let segundos = std::env::var("RUSTRON_CAPTURA_SEGUNDOS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20);
    let (ventana, app, interfaz) = (ventana.clone(), app.clone(), interfaz.clone());
    glib::timeout_add_local_once(Duration::from_secs(segundos), move || {
        let guardar = {
            let interfaz = interfaz.clone();
            move || {
                let paintable = gtk4::WidgetPaintable::new(Some(&ventana));
                let snapshot = gtk4::Snapshot::new();
                paintable.snapshot(
                    &snapshot,
                    f64::from(ventana.width()),
                    f64::from(ventana.height()),
                );
                let imagen = snapshot
                    .to_node()
                    .zip(ventana.native().and_then(|n| n.renderer()))
                    .map(|(nodo, render)| render.render_texture(&nodo, None));
                if let Some(textura) = imagen {
                    match textura.save_to_png(&ruta) {
                        Ok(()) => eprintln!("capturado: {}", ruta.display()),
                        Err(error) => eprintln!("no se pudo guardar la captura: {error}"),
                    }
                    return app.quit();
                }
                // A veces la ventana no da imagen (p. ej. con la barra flotante de Zen abierta): se usa la
                // captura de WebKit, que solo incluye la interfaz (sin las pestañas web).
                eprintln!("la ventana no dio imagen: se captura solo la interfaz");
                let app = app.clone();
                let ruta = ruta.clone();
                interfaz.snapshot(
                    webkit6::SnapshotRegion::FullDocument,
                    webkit6::SnapshotOptions::NONE,
                    None::<&gtk4::gio::Cancellable>,
                    move |r| {
                        match r.map(|t| t.save_to_png(&ruta)) {
                            Ok(Ok(())) => eprintln!("capturado: {}", ruta.display()),
                            Ok(Err(e)) => eprintln!("no se pudo guardar la captura: {e}"),
                            Err(e) => eprintln!("WebKit no dio la captura: {e}"),
                        }
                        app.quit();
                    },
                );
            }
        };
        let Some(sondas) =
            std::env::var_os("RUSTRON_SONDA").and_then(|r| fs::read_to_string(r).ok())
        else {
            return guardar();
        };
        // Varios scripts separados por una línea `//---` se evalúan en orden, con 3 s entre ellos (`RUSTRON_SONDA_PAUSA`).
        let guiones: Vec<String> = sondas.split("\n//---\n").map(str::to_owned).collect();
        ejecutar_sondas(interfaz, guiones, 0, Rc::new(guardar));
    });
}

fn ejecutar_sondas(
    interfaz: WebView,
    guiones: Vec<String>,
    indice: usize,
    al_terminar: Rc<dyn Fn()>,
) {
    let Some(guion) = guiones.get(indice).cloned() else {
        return al_terminar();
    };
    let vista = interfaz.clone();
    vista.evaluate_javascript(
        &guion,
        None,
        None,
        None::<&gtk4::gio::Cancellable>,
        move |r| {
            match r {
                Ok(valor) => eprintln!("SONDA {indice} -> {}", valor.to_str()),
                Err(error) => eprintln!("SONDA {indice} falló: {error}"),
            }
            let pausa = std::env::var("RUSTRON_SONDA_PAUSA")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3);
            glib::timeout_add_local_once(Duration::from_secs(pausa), move || {
                ejecutar_sondas(interfaz, guiones, indice + 1, al_terminar);
            });
        },
    );
}

fn al_recibir(zen: &Rc<Zen>, texto: &str) {
    if let Ok(valor) = serde_json::from_str::<Value>(texto) {
        match valor["tipo"].as_str() {
            Some("area-contenido") => return colocar_contenido(zen, &valor),
            Some("atajos") => return guardar_atajos(zen, &valor),
            Some("popups") => return popups_abiertos(zen, &valor),
            Some("vista") => {
                return orden_de_vista(zen, valor["orden"].as_str().unwrap_or_default());
            }
            _ => {}
        }
    }
    let resultado = {
        let mut navegador = zen.navegador.borrow_mut();
        zen.puente.borrow_mut().orden(&mut navegador, texto)
    };
    match resultado {
        Err(error) => eprintln!("{error}"),
        Ok(mut salida) => {
            let peticion = salida.peticion.take();
            aplicar(zen, salida);
            if let Some(p) = peticion {
                let respuesta = match p.metodo.as_str() {
                    "config" => Ok(json!({
                        "buscador": zen.config.general.search_engine,
                        "inicio": zen.config.general.homepage,
                    })),
                    metodo => zen.almacen.atender(metodo, &p.args),
                };
                entregar(zen, &[Puente::respuesta(p.id, respuesta)]);
            }
        }
    }
}

/// Entrega los mensajes a la interfaz y ejecuta los efectos, sin tener ninguna `RefCell` prestada.
fn aplicar(zen: &Rc<Zen>, salida: Salida) {
    entregar(zen, &salida.mensajes);
    sincronizar_vistas(zen);
    for efecto in salida.efectos {
        ejecutar(zen, efecto);
    }
    mostrar_activa(zen);
    actualizar_titulo(zen);
}

/// El título de la ventana es el de la pestaña activa (o su dirección mientras no lo tiene).
fn actualizar_titulo(zen: &Rc<Zen>) {
    let Some(ventana) = zen.ventana.get() else {
        return;
    };
    let navegador = zen.navegador.borrow();
    let activa = navegador.active_tab.and_then(|id| navegador.tab(id));
    let texto = activa
        .map(|t| {
            if t.title.is_empty() {
                t.uri.as_str()
            } else {
                t.title.as_str()
            }
        })
        .unwrap_or_default();
    ventana.set_title(Some(&if texto.is_empty() {
        "Rustron".to_string()
    } else {
        format!("Rustron — {texto}")
    }));
}

fn entregar(zen: &Rc<Zen>, mensajes: &[String]) {
    if let Some(interfaz) = zen.interfaz.get() {
        mensajes
            .iter()
            .for_each(|m| entregar_a_interfaz(interfaz, m));
    }
}

fn nombre_vista(tab: TabId) -> String {
    format!("tab-{}", tab.0)
}

fn mostrar_activa(zen: &Rc<Zen>) {
    if let Some(tab) = zen.navegador.borrow().active_tab {
        zen.pila.set_visible_child_name(&nombre_vista(tab));
    }
}

/// Crea una vista de WebKit por cada pestaña del núcleo que aún no la tenga.
fn sincronizar_vistas(zen: &Rc<Zen>) {
    let pendientes: Vec<(TabId, String)> = zen
        .navegador
        .borrow()
        .tabs
        .iter()
        .filter(|t| !zen.vistas.borrow().contains_key(&t.id))
        .map(|t| (t.id, t.uri.clone()))
        .collect();
    for (tab, uri) in pendientes {
        let vista = zen.motor.nueva_vista();
        conectar_vista(zen, tab, &vista);
        zen.pila.add_named(&vista, Some(&nombre_vista(tab)));
        zen.vistas.borrow_mut().insert(tab, vista.clone());
        vista.load_uri(&uri);
    }
}

fn ejecutar(zen: &Rc<Zen>, efecto: Effect) {
    let vista = |tab| zen.vistas.borrow().get(&tab).cloned();
    match efecto {
        Effect::Navigate { tab, uri } => {
            if let Some(v) = vista(tab) {
                v.load_uri(&uri);
            }
        }
        Effect::Reload { tab, hard } => {
            if let Some(v) = vista(tab) {
                if hard {
                    v.reload_bypass_cache();
                } else {
                    v.reload();
                }
            }
        }
        Effect::GoBack(tab) => {
            if let Some(v) = vista(tab) {
                v.go_back();
            }
        }
        Effect::GoForward(tab) => {
            if let Some(v) = vista(tab) {
                v.go_forward();
            }
        }
        Effect::Release(tab) => {
            let quitada = zen.vistas.borrow_mut().remove(&tab);
            if let Some(v) = quitada {
                zen.pila.remove(&v);
            }
        }
        Effect::ToggleAdblock { .. } => {}
    }
}

/// Lo que el motor reporta de una pestaña entra al núcleo por el puente, que avisa a la interfaz.
/// Se difiere al bucle principal: WebKit puede notificar dentro de `load_uri`.
fn conectar_vista(zen: &Rc<Zen>, tab: TabId, vista: &WebView) {
    let enviar = |zen: &Rc<Zen>, evento: EngineEvent| {
        let zen = zen.clone();
        glib::idle_add_local_once(move || {
            let salida = {
                let mut navegador = zen.navegador.borrow_mut();
                zen.puente
                    .borrow_mut()
                    .evento_motor(&mut navegador, evento.clone())
            };
            if std::env::var_os("RUSTRON_DEPURA").is_some() {
                eprintln!("motor -> {:?} => {:?}", evento, salida.mensajes);
            }
            aplicar(&zen, salida);
        });
    };
    {
        let zen = zen.clone();
        vista.connect_title_notify(move |v| {
            let title = v.title().map(|t| t.to_string()).unwrap_or_default();
            enviar(&zen, EngineEvent::TitleChanged { tab, title });
        });
    }
    {
        let zen = zen.clone();
        vista.connect_uri_notify(move |v| {
            let uri = v.uri().map(|t| t.to_string()).unwrap_or_default();
            enviar(&zen, EngineEvent::UrlChanged { tab, uri });
        });
    }
    {
        let zen = zen.clone();
        vista.connect_favicon_notify(move |v| {
            let icon = v.favicon().and_then(|t| icono_como_uri(&t));
            enviar(&zen, EngineEvent::FaviconChanged { tab, icon });
        });
    }
    {
        let zen = zen.clone();
        vista.connect_load_changed(move |_, suceso| {
            let loading = !matches!(suceso, LoadEvent::Finished);
            enviar(&zen, EngineEvent::LoadingChanged { tab, loading });
        });
    }
}

/// El icono de la pestaña como URI `data:` PNG, que es lo que la interfaz pone en un `<img>`.
fn icono_como_uri(textura: &gtk4::gdk::Texture) -> Option<String> {
    let bytes = textura.save_to_png_bytes();
    Some(format!("data:image/png;base64,{}", base64(&bytes)))
}

fn base64(datos: &[u8]) -> String {
    const ALFABETO: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut salida = String::with_capacity(datos.len().div_ceil(3) * 4);
    for trozo in datos.chunks(3) {
        let n = (u32::from(trozo[0]) << 16)
            | (u32::from(*trozo.get(1).unwrap_or(&0)) << 8)
            | u32::from(*trozo.get(2).unwrap_or(&0));
        for (i, desplazamiento) in [18, 12, 6, 0].into_iter().enumerate() {
            if i <= trozo.len() {
                salida.push(char::from(ALFABETO[((n >> desplazamiento) & 63) as usize]));
            } else {
                salida.push('=');
            }
        }
    }
    salida
}

// ---------------------------------------------------------------------------------------------
// Menús sobre la página

/// La vista de la pestaña web va encima de la interfaz y taparía los menús que se abren sobre ella. Mientras un
/// menú la cubre, la vista se congela: la interfaz la muestra como imagen (en el hueco) y la vista se oculta.
fn popups_abiertos(zen: &Rc<Zen>, mensaje: &Value) {
    let (ax, ay, aancho, aalto) = zen.area.get();
    let cubre = mensaje["rects"].as_array().is_some_and(|rects| {
        rects.iter().any(|r| {
            let n = |c: &str| r[c].as_i64().unwrap_or(0) as i32;
            n("x") < ax + aancho
                && ax < n("x") + n("ancho")
                && n("y") < ay + aalto
                && ay < n("y") + n("alto")
        })
    });
    match (cubre, zen.congelada.get()) {
        (true, false) => congelar(zen),
        (false, true) => descongelar(zen),
        _ => {}
    }
}

fn congelar(zen: &Rc<Zen>) {
    zen.congelada.set(true);
    let uri = imagen_de(&zen.pila).and_then(|t| icono_como_uri(&t));
    let ocultar = {
        let zen = zen.clone();
        move || {
            // Solo si sigue haciendo falta: el menú pudo cerrarse mientras tanto.
            if zen.congelada.get() {
                zen.pila.set_visible(false);
            }
        }
    };
    match (zen.interfaz.get(), uri) {
        (Some(interfaz), Some(uri)) => {
            let guion = format!(
                "window.__rustronCongelar && window.__rustronCongelar({})",
                json!(uri)
            );
            // La imagen ya está pintada en la interfaz cuando se oculta la vista: sin parpadeo.
            interfaz.evaluate_javascript(
                &guion,
                None,
                None,
                None::<&gtk4::gio::Cancellable>,
                move |_| {
                    glib::timeout_add_local_once(Duration::from_millis(80), ocultar);
                },
            );
        }
        _ => ocultar(),
    }
}

fn descongelar(zen: &Rc<Zen>) {
    zen.congelada.set(false);
    zen.pila.set_visible(true);
    zen.superposicion.queue_allocate();
    if let Some(interfaz) = zen.interfaz.get() {
        let interfaz = interfaz.clone();
        // La imagen se quita un instante después, cuando la vista real ya está pintada otra vez.
        glib::timeout_add_local_once(Duration::from_millis(60), move || {
            interfaz.evaluate_javascript(
                "window.__rustronDescongelar && window.__rustronDescongelar()",
                None,
                None,
                None::<&gtk4::gio::Cancellable>,
                |_| {},
            );
        });
    }
}

/// Imagen de un widget tal como se ve ahora.
fn imagen_de(widget: &impl IsA<gtk4::Widget>) -> Option<gtk4::gdk::Texture> {
    let (ancho, alto) = (widget.width(), widget.height());
    if ancho <= 0 || alto <= 0 {
        return None;
    }
    let paintable = gtk4::WidgetPaintable::new(Some(widget));
    let snapshot = gtk4::Snapshot::new();
    paintable.snapshot(&snapshot, f64::from(ancho), f64::from(alto));
    let nodo = snapshot.to_node()?;
    Some(widget.native()?.renderer()?.render_texture(&nodo, None))
}

// ---------------------------------------------------------------------------------------------
// Teclado y órdenes de ventana

/// Un `<key>` de la interfaz, con los nombres de tecla del DOM (`t`, `Tab`, `F5`, `ArrowLeft`...).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Atajo {
    tecla: String,
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
}

impl Atajo {
    /// ¿Esta pulsación es el atajo? Mismas reglas que `coincide` de `shell/shim/atajos.js`: Ctrl, Alt y
    /// Super exactos; Shift solo cuenta en teclas con nombre y en letras o dígitos (el de un símbolo lo da la tecla).
    fn coincide(&self, tecla: &str, ctrl: bool, shift: bool, alt: bool, meta: bool) -> bool {
        let compara_shift =
            self.tecla.chars().count() > 1 || self.tecla.chars().all(|c| c.is_ascii_alphanumeric());
        self.tecla == tecla
            && self.ctrl == ctrl
            && self.alt == alt
            && self.meta == meta
            && (!compara_shift || self.shift == shift)
    }

    /// Solo se vigilan con el foco en una página las teclas con Ctrl/Alt/Super o las de función: las demás
    /// (Retroceso, Supr, letras sueltas) son de la página.
    fn vigilable(&self) -> bool {
        self.ctrl
            || self.alt
            || self.meta
            || self
                .tecla
                .strip_prefix('F')
                .is_some_and(|n| n.parse::<u8>().is_ok())
    }
}

fn guardar_atajos(zen: &Rc<Zen>, mensaje: &Value) {
    let lista = mensaje["lista"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let atajos = lista
        .iter()
        .filter_map(|a| {
            Some(Atajo {
                tecla: a["key"].as_str()?.to_string(),
                ctrl: a["ctrl"].as_bool()?,
                shift: a["shift"].as_bool()?,
                alt: a["alt"].as_bool()?,
                meta: a["meta"].as_bool()?,
            })
        })
        .filter(Atajo::vigilable)
        .collect();
    *zen.atajos.borrow_mut() = atajos;
}

/// Nombre de tecla del DOM (el de `KeyboardEvent.key`, en minúscula para los caracteres).
fn nombre_dom(tecla: gtk4::gdk::Key) -> Option<String> {
    if let Some(c) = tecla.to_unicode().filter(|c| !c.is_control()) {
        return Some(c.to_lowercase().collect());
    }
    let nombre = tecla.name()?;
    let dom = match nombre.as_str() {
        "Tab" | "ISO_Left_Tab" => "Tab",
        "Left" => "ArrowLeft",
        "Right" => "ArrowRight",
        "Up" => "ArrowUp",
        "Down" => "ArrowDown",
        "Page_Up" => "PageUp",
        "Page_Down" => "PageDown",
        "Return" | "KP_Enter" => "Enter",
        "BackSpace" => "Backspace",
        "Escape" | "Home" | "End" | "Delete" | "Insert" => return Some(nombre.to_string()),
        otro if otro
            .strip_prefix('F')
            .is_some_and(|n| n.parse::<u8>().is_ok()) =>
        {
            return Some(otro.to_string());
        }
        _ => return None,
    };
    Some(dom.to_string())
}

/// Con el foco en una pestaña web las teclas son de WebKit; las que son atajos de la interfaz se capturan
/// antes y se reenvían a la interfaz, que ejecuta el comando.
fn vigilar_teclas(zen: &Rc<Zen>) {
    let controlador = gtk4::EventControllerKey::new();
    controlador.set_propagation_phase(gtk4::PropagationPhase::Capture);
    let zen = zen.clone();
    let objetivo = zen.pila.clone();
    controlador.connect_key_pressed(move |_, tecla, _, estado| {
        use gtk4::gdk::ModifierType as M;
        let Some(nombre) = nombre_dom(tecla) else {
            return glib::Propagation::Proceed;
        };
        let ctrl = estado.contains(M::CONTROL_MASK);
        let alt = estado.contains(M::ALT_MASK);
        let meta = estado.intersects(M::SUPER_MASK | M::META_MASK);
        let shift = estado.contains(M::SHIFT_MASK) || tecla == gtk4::gdk::Key::ISO_Left_Tab;
        if !zen
            .atajos
            .borrow()
            .iter()
            .any(|a| a.coincide(&nombre, ctrl, shift, alt, meta))
        {
            return glib::Propagation::Proceed;
        }
        if let Some(interfaz) = zen.interfaz.get() {
            let evento = json!({ "key": nombre, "ctrlKey": ctrl, "shiftKey": shift, "altKey": alt, "metaKey": meta });
            let guion = format!("window.__rustronTecla && window.__rustronTecla({evento})");
            interfaz.evaluate_javascript(&guion, None, None, None::<&gtk4::gio::Cancellable>, |_| {});
        }
        glib::Propagation::Stop
    });
    objetivo.add_controller(controlador);
}

const PASOS_DE_ZOOM: [f64; 16] = [
    0.3, 0.5, 0.67, 0.8, 0.9, 1.0, 1.1, 1.2, 1.33, 1.5, 1.7, 2.0, 2.4, 3.0, 4.0, 5.0,
];

/// Órdenes de ventana que la interfaz pide (los comandos de Firefox que no son estado del navegador).
fn orden_de_vista(zen: &Rc<Zen>, orden: &str) {
    let activa = zen
        .navegador
        .borrow()
        .active_tab
        .and_then(|t| zen.vistas.borrow().get(&t).cloned());
    match orden {
        "salir" => zen.aplicacion.quit(),
        "pantalla-completa" => {
            if let Some(v) = zen.ventana.get() {
                v.set_fullscreened(!v.is_fullscreen());
            }
        }
        "detener" => {
            if let Some(v) = activa {
                v.stop_loading();
            }
        }
        "zoom-mas" | "zoom-menos" | "zoom-reset" => {
            if let Some(v) = activa {
                let actual = v.zoom_level();
                let nuevo = match orden {
                    "zoom-reset" => Some(1.0),
                    "zoom-mas" => PASOS_DE_ZOOM.iter().copied().find(|p| *p > actual + 0.001),
                    _ => PASOS_DE_ZOOM
                        .iter()
                        .rev()
                        .copied()
                        .find(|p| *p < actual - 0.001),
                }
                .unwrap_or(actual);
                v.set_zoom_level(nuevo);
            }
        }
        otra => eprintln!("orden de vista desconocida: {otra}"),
    }
}

/// Coloca la pila de pestañas web sobre el rectángulo que reserva la interfaz.
fn colocar_contenido(zen: &Rc<Zen>, area: &Value) {
    let numero = |campo: &str| area[campo].as_f64().unwrap_or(0.0).round() as i32;
    let (x, y, ancho, alto) = (numero("x"), numero("y"), numero("ancho"), numero("alto"));
    if ancho <= 0 || alto <= 0 {
        zen.pila.set_visible(false);
        return;
    }
    // Las esquinas redondeadas son las del contenedor de Zen: la pila las recorta (overflow oculto).
    let radio = area["radio"].as_f64().unwrap_or(0.0).max(0.0);
    zen.estilo
        .load_from_data(&format!(".contenido-zen {{ border-radius: {radio}px; }}"));
    zen.area.set((x.max(0), y.max(0), ancho, alto));
    if zen.congelada.get() {
        return zen.superposicion.queue_allocate(); // sigue oculta hasta que se cierre el menú
    }
    zen.superposicion.queue_allocate();
    zen.pila.set_visible(true);
}

/// La vista de la interfaz tiene el puente: solo puede mostrar el servidor local de la interfaz.
fn limitar_navegacion(interfaz: &WebView, puerto: u16) {
    let origen = format!("http://127.0.0.1:{puerto}/");
    interfaz.connect_decide_policy(move |_, decision, tipo| {
        if !matches!(
            tipo,
            webkit6::PolicyDecisionType::NavigationAction
                | webkit6::PolicyDecisionType::NewWindowAction
        ) {
            return false;
        }
        let Some(navegacion) = decision.downcast_ref::<webkit6::NavigationPolicyDecision>() else {
            return false;
        };
        let uri = navegacion
            .navigation_action()
            .and_then(|mut a| a.request())
            .and_then(|r| r.uri())
            .map(|u| u.to_string())
            .unwrap_or_default();
        if tipo == webkit6::PolicyDecisionType::NavigationAction && uri.starts_with(&origen) {
            return false; // la decisión por defecto: permitir
        }
        eprintln!("la interfaz no puede navegar a {uri}");
        decision.ignore();
        true
    });
}

// ---------------------------------------------------------------------------------------------
// Zen y su servidor

/// Extrae una copia de Zen (datos que no se ejecutan) y arranca el servidor de la interfaz.
fn arrancar_servidor(datos: &Path) -> Result<(Servidor, u16), String> {
    let (browser, gre) = extraer_zen(datos)?;
    let script = std::env::var_os("RUSTRON_SERVIDOR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/servir-zen.py")
        });
    if !script.is_file() {
        return Err(format!(
            "no encuentro el servidor de la interfaz ({}); defina RUSTRON_SERVIDOR",
            script.display()
        ));
    }
    let puerto = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .and_then(|l| l.local_addr())
        .map_err(|e| e.to_string())?
        .port();
    let hijo = Command::new("python3")
        .arg("-I")
        .arg(&script)
        .arg(&browser)
        .arg(&gre)
        .arg(puerto.to_string())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("no se pudo arrancar python3: {e}"))?;
    let servidor = Servidor(hijo);
    // Hasta 20 s: en un equipo modesto, o con la CPU limitada, python tarda en arrancar.
    for _ in 0..400 {
        if TcpStream::connect((Ipv4Addr::LOCALHOST, puerto)).is_ok() {
            return Ok((servidor, puerto));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err("el servidor de la interfaz no respondió".into())
}

/// Copia los `omni.ja` de Zen (ZIP) a `datos/zen/{browser,gre}`, solo si cambiaron.
fn extraer_zen(datos: &Path) -> Result<(PathBuf, PathBuf), String> {
    let instalacion = std::env::var_os("RUSTRON_ZEN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(INSTALACION_POR_DEFECTO));
    let destino = datos.join("zen");
    let mut carpetas = Vec::new();
    for (nombre, omni) in [
        ("browser", instalacion.join("browser/omni.ja")),
        ("gre", instalacion.join("omni.ja")),
    ] {
        let meta =
            fs::metadata(&omni).map_err(|e| format!("no se puede leer {}: {e}", omni.display()))?;
        let huella = format!(
            "{}-{:?}",
            meta.len(),
            meta.modified()
                .ok()
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        );
        let carpeta = destino.join(nombre);
        let sello = destino.join(format!("{nombre}.sello"));
        if fs::read_to_string(&sello).ok().as_deref() != Some(huella.as_str()) {
            eprintln!("extrayendo {} (la primera vez tarda)…", omni.display());
            let _ = fs::remove_dir_all(&carpeta);
            fs::create_dir_all(&carpeta).map_err(|e| e.to_string())?;
            // `unzip` avisa de los datos extra al principio de omni.ja y sale con 1 o 2 aunque extrae todo:
            // se acepta 0..=2 y se comprueba el resultado.
            let estado = Command::new("unzip")
                .args(["-q", "-o"])
                .arg(&omni)
                .arg("-d")
                .arg(&carpeta)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|e| format!("no se pudo ejecutar unzip: {e}"))?;
            if !matches!(estado.code(), Some(0..=2)) || !carpeta.join("chrome").is_dir() {
                return Err(format!(
                    "unzip falló con {estado} al extraer {}",
                    omni.display()
                ));
            }
            fs::write(&sello, huella).map_err(|e| e.to_string())?;
        }
        carpetas.push(carpeta);
    }
    let gre = carpetas.pop().unwrap_or_default();
    let browser = carpetas.pop().unwrap_or_default();
    Ok((browser, gre))
}

#[cfg(test)]
mod pruebas {
    use super::{Atajo, base64};

    fn atajo(tecla: &str, ctrl: bool, shift: bool) -> Atajo {
        Atajo {
            tecla: tecla.into(),
            ctrl,
            shift,
            alt: false,
            meta: false,
        }
    }

    #[test]
    fn el_atajo_exige_los_modificadores_exactos() {
        let nueva = atajo("t", true, false);
        assert!(nueva.coincide("t", true, false, false, false));
        assert!(!nueva.coincide("t", false, false, false, false));
        assert!(!nueva.coincide("t", true, false, true, false));
        assert!(
            !nueva.coincide("t", true, true, false, false),
            "Ctrl+Shift+T es otro atajo"
        );
        assert!(atajo("t", true, true).coincide("t", true, true, false, false));
    }

    #[test]
    fn el_shift_de_un_simbolo_no_cuenta() {
        assert!(atajo("+", true, false).coincide("+", true, true, false, false));
    }

    #[test]
    fn solo_se_vigilan_teclas_con_modificador_o_de_funcion() {
        assert!(atajo("t", true, false).vigilable());
        assert!(atajo("F5", false, false).vigilable());
        assert!(
            !atajo("Backspace", false, false).vigilable(),
            "es de la página"
        );
        assert!(!atajo("a", false, false).vigilable());
    }

    #[test]
    fn base64_coincide_con_los_vectores_del_rfc_4648() {
        for (entrada, esperado) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(entrada.as_bytes()), esperado);
        }
    }
}
