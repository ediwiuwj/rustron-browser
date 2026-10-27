use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;

use gtk4::gdk;
use gtk4::glib::{self, ControlFlow, Propagation};
use gtk4::prelude::*;
use rustron_core::{Action, Browser, Effect, EngineEvent, TabId, WorkspaceId};
use rustron_engine::{LoadEvent, Motor, WebView};
use webkit6::prelude::WebViewExt;

const INICIO_POR_DEFECTO: &str = "https://example.com";
const LISTAS: &[(&str, &str)] = &[
    ("easylist.txt", "https://easylist.to/easylist/easylist.txt"),
    (
        "easyprivacy.txt",
        "https://easylist.to/easylist/easyprivacy.txt",
    ),
];

struct Estado {
    navegador: Browser,
    vistas: HashMap<TabId, WebView>,
    motor: Motor,
}

#[derive(Clone)]
struct Ui {
    estado: Rc<RefCell<Estado>>,
    ventana: gtk4::ApplicationWindow,
    barra_lateral: gtk4::Box,
    lista: gtk4::Box,
    pila: gtk4::Stack,
    url: gtk4::Entry,
}

fn main() -> glib::ExitCode {
    let app = gtk4::Application::builder()
        .application_id("org.rustron.Rustron")
        .build();
    app.connect_activate(construir);
    let sin_argumentos: [&str; 0] = [];
    app.run_with_args(&sin_argumentos)
}

fn construir(app: &gtk4::Application) {
    let datos = glib::user_data_dir().join("rustron");
    let motor = Motor::new(&datos.join("filtros"));
    let estado = Rc::new(RefCell::new(Estado {
        navegador: Browser::new(),
        vistas: HashMap::new(),
        motor,
    }));

    let ventana = gtk4::ApplicationWindow::builder()
        .application(app)
        .title("Rustron")
        .default_width(1100)
        .default_height(720)
        .build();

    let barra_lateral = gtk4::Box::new(gtk4::Orientation::Vertical, 6);
    barra_lateral.set_width_request(220);
    barra_lateral.set_margin_top(8);
    barra_lateral.set_margin_bottom(8);
    barra_lateral.set_margin_start(8);
    barra_lateral.set_margin_end(4);
    let nueva = gtk4::Button::with_label("+ Nueva pestaña");
    let lista = gtk4::Box::new(gtk4::Orientation::Vertical, 2);
    let desplazable = gtk4::ScrolledWindow::builder()
        .vexpand(true)
        .child(&lista)
        .build();
    barra_lateral.append(&nueva);
    barra_lateral.append(&desplazable);

    let atras = gtk4::Button::with_label("←");
    let adelante = gtk4::Button::with_label("→");
    let recargar = gtk4::Button::with_label("⟳");
    let url = gtk4::Entry::builder()
        .hexpand(true)
        .placeholder_text("Escribe una dirección o búsqueda")
        .build();
    let barra_url = gtk4::Box::new(gtk4::Orientation::Horizontal, 6);
    barra_url.set_margin_top(6);
    barra_url.set_margin_bottom(6);
    barra_url.set_margin_start(6);
    barra_url.set_margin_end(6);
    barra_url.append(&atras);
    barra_url.append(&adelante);
    barra_url.append(&recargar);
    barra_url.append(&url);

    let pila = gtk4::Stack::builder().hexpand(true).vexpand(true).build();
    let contenido = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    contenido.append(&barra_url);
    contenido.append(&pila);

    let raiz = gtk4::Box::new(gtk4::Orientation::Horizontal, 0);
    raiz.append(&barra_lateral);
    raiz.append(&contenido);
    ventana.set_child(Some(&raiz));

    let ui = Ui {
        estado,
        ventana: ventana.clone(),
        barra_lateral,
        lista,
        pila,
        url: url.clone(),
    };

    {
        let u = ui.clone();
        nueva.connect_clicked(move |_| {
            ejecutar(
                &u,
                Action::NewTab {
                    uri: None,
                    workspace: None,
                },
            )
        });
    }
    {
        let u = ui.clone();
        atras.connect_clicked(move |_| {
            if let Some(tab) = pestana_activa(&u) {
                ejecutar(&u, Action::GoBack(tab));
            }
        });
    }
    {
        let u = ui.clone();
        adelante.connect_clicked(move |_| {
            if let Some(tab) = pestana_activa(&u) {
                ejecutar(&u, Action::GoForward(tab));
            }
        });
    }
    {
        let u = ui.clone();
        recargar.connect_clicked(move |_| {
            if let Some(tab) = pestana_activa(&u) {
                ejecutar(&u, Action::Reload { tab, hard: false });
            }
        });
    }
    {
        let u = ui.clone();
        url.connect_activate(move |entrada| {
            let texto = entrada.text().to_string();
            if let Some(tab) = pestana_activa(&u) {
                ejecutar(&u, Action::Navigate { tab, input: texto });
            }
        });
    }

    let teclas = gtk4::EventControllerKey::new();
    {
        let u = ui.clone();
        teclas.connect_key_pressed(move |_, tecla, _codigo, modificadores| {
            let ctrl = modificadores.contains(gdk::ModifierType::CONTROL_MASK);
            let shift = modificadores.contains(gdk::ModifierType::SHIFT_MASK);
            let alt = modificadores.contains(gdk::ModifierType::ALT_MASK);
            if ctrl && !shift && tecla.to_unicode().map(|c| c.to_ascii_lowercase()) == Some('l') {
                u.url.grab_focus();
                return Propagation::Stop;
            }
            match accion_de_tecla(&u, tecla, ctrl, shift, alt) {
                Some(accion) => {
                    ejecutar(&u, accion);
                    Propagation::Stop
                }
                None => Propagation::Proceed,
            }
        });
    }
    ventana.add_controller(teclas);

    let inicio = std::env::args()
        .nth(1)
        .unwrap_or_else(|| INICIO_POR_DEFECTO.to_string());
    ejecutar(
        &ui,
        Action::NewTab {
            uri: Some(inicio),
            workspace: None,
        },
    );

    cargar_bloqueador(&ui, datos.join("listas"));
    ventana.present();
}

fn pestana_activa(ui: &Ui) -> Option<TabId> {
    ui.estado.borrow().navegador.active_tab
}

fn nombre_vista(tab: TabId) -> String {
    format!("tab-{}", tab.0)
}

fn ejecutar(ui: &Ui, accion: Action) {
    let efectos = ui.estado.borrow_mut().navegador.dispatch(accion);
    sincronizar_vistas(ui);
    for efecto in efectos {
        aplicar(ui, efecto);
    }
    refrescar(ui);
}

fn evento(ui: &Ui, evento: EngineEvent) {
    ui.estado.borrow_mut().navegador.apply_event(evento);
    refrescar(ui);
}

fn sincronizar_vistas(ui: &Ui) {
    let pendientes: Vec<(TabId, String)> = {
        let estado = ui.estado.borrow();
        estado
            .navegador
            .tabs
            .iter()
            .filter(|t| !estado.vistas.contains_key(&t.id))
            .map(|t| (t.id, t.uri.clone()))
            .collect()
    };
    for (tab, uri) in pendientes {
        let vista = ui.estado.borrow().motor.nueva_vista();
        conectar(ui, tab, &vista);
        ui.pila.add_named(&vista, Some(&nombre_vista(tab)));
        ui.estado.borrow_mut().vistas.insert(tab, vista.clone());
        vista.load_uri(&uri);
    }
}

fn conectar(ui: &Ui, tab: TabId, vista: &WebView) {
    {
        let u = ui.clone();
        vista.connect_title_notify(move |v| {
            let title = v.title().map(|t| t.to_string()).unwrap_or_default();
            evento(&u, EngineEvent::TitleChanged { tab, title });
        });
    }
    {
        let u = ui.clone();
        vista.connect_uri_notify(move |v| {
            let uri = v.uri().map(|t| t.to_string()).unwrap_or_default();
            evento(&u, EngineEvent::UrlChanged { tab, uri });
        });
    }
    {
        let u = ui.clone();
        vista.connect_load_changed(move |_, suceso| {
            let loading = !matches!(suceso, LoadEvent::Finished);
            evento(&u, EngineEvent::LoadingChanged { tab, loading });
        });
    }
}

fn vista_de(ui: &Ui, tab: TabId) -> Option<WebView> {
    ui.estado.borrow().vistas.get(&tab).cloned()
}

fn aplicar(ui: &Ui, efecto: Effect) {
    match efecto {
        Effect::Navigate { tab, uri } => {
            if let Some(vista) = vista_de(ui, tab) {
                vista.load_uri(&uri);
            }
        }
        Effect::Reload { tab, hard } => {
            if let Some(vista) = vista_de(ui, tab) {
                if hard {
                    vista.reload_bypass_cache();
                } else {
                    vista.reload();
                }
            }
        }
        Effect::GoBack(tab) => {
            if let Some(vista) = vista_de(ui, tab) {
                vista.go_back();
            }
        }
        Effect::GoForward(tab) => {
            if let Some(vista) = vista_de(ui, tab) {
                vista.go_forward();
            }
        }
        Effect::Release(tab) => {
            let quitada = ui.estado.borrow_mut().vistas.remove(&tab);
            if let Some(vista) = quitada {
                ui.pila.remove(&vista);
            }
        }
        Effect::ToggleAdblock { .. } => {}
    }
}

fn refrescar(ui: &Ui) {
    let (pestanas, activa, uri_activa, barra_visible, titulo_ventana) = {
        let estado = ui.estado.borrow();
        let navegador = &estado.navegador;
        let ids: Vec<TabId> = navegador
            .workspace(navegador.active_workspace)
            .map(|ws| ws.tabs.clone())
            .unwrap_or_default();
        let pestanas: Vec<(TabId, String)> = ids
            .iter()
            .filter_map(|id| navegador.tab(*id))
            .map(|t| {
                let texto = if t.title.is_empty() {
                    t.uri.clone()
                } else {
                    t.title.clone()
                };
                (t.id, texto)
            })
            .collect();
        let activa = navegador.active_tab;
        let uri_activa = activa
            .and_then(|id| navegador.tab(id))
            .map(|t| t.uri.clone())
            .unwrap_or_default();
        let titulo = activa
            .and_then(|id| navegador.tab(id))
            .map(|t| {
                if t.title.is_empty() {
                    t.uri.clone()
                } else {
                    t.title.clone()
                }
            })
            .unwrap_or_default();
        let titulo_ventana = format!("Rustron — {titulo} [{} pestañas]", pestanas.len());
        (
            pestanas,
            activa,
            uri_activa,
            navegador.sidebar_visible,
            titulo_ventana,
        )
    };

    while let Some(hijo) = ui.lista.first_child() {
        ui.lista.remove(&hijo);
    }
    for (id, texto) in pestanas {
        let boton = gtk4::Button::with_label(&texto);
        boton.set_halign(gtk4::Align::Fill);
        boton.add_css_class("flat");
        if Some(id) == activa {
            boton.add_css_class("suggested-action");
        }
        let u = ui.clone();
        boton.connect_clicked(move |_| ejecutar(&u, Action::ActivateTab(id)));
        ui.lista.append(&boton);
    }

    if let Some(tab) = activa {
        ui.pila.set_visible_child_name(&nombre_vista(tab));
    }
    if !ui.url.has_focus() {
        ui.url.set_text(&uri_activa);
    }
    ui.barra_lateral.set_visible(barra_visible);
    ui.ventana.set_title(Some(&titulo_ventana));
}

fn accion_de_tecla(ui: &Ui, tecla: gdk::Key, ctrl: bool, shift: bool, alt: bool) -> Option<Action> {
    let activa = pestana_activa(ui);
    if ctrl && (tecla == gdk::Key::Tab || tecla == gdk::Key::ISO_Left_Tab) {
        let delta = if shift || tecla == gdk::Key::ISO_Left_Tab {
            -1
        } else {
            1
        };
        return vecina(ui, delta).map(Action::ActivateTab);
    }
    if alt && tecla == gdk::Key::Left {
        return activa.map(Action::GoBack);
    }
    if alt && tecla == gdk::Key::Right {
        return activa.map(Action::GoForward);
    }
    let letra = tecla.to_unicode().map(|c| c.to_ascii_lowercase());
    if alt {
        if let Some(digito) = letra
            .and_then(|c| c.to_digit(10))
            .filter(|d| (1..=9).contains(d))
        {
            return Some(Action::SwitchWorkspace(WorkspaceId(u64::from(digito))));
        }
        return None;
    }
    if !ctrl {
        return None;
    }
    match letra? {
        't' => Some(Action::NewTab {
            uri: None,
            workspace: None,
        }),
        'w' => activa.map(Action::CloseTab),
        'r' => activa.map(|tab| Action::Reload { tab, hard: shift }),
        'e' if shift => Some(Action::ToggleSidebar),
        'c' if shift => Some(Action::ToggleCompact),
        _ => None,
    }
}

fn vecina(ui: &Ui, delta: isize) -> Option<TabId> {
    let estado = ui.estado.borrow();
    let navegador = &estado.navegador;
    let ws = navegador.workspace(navegador.active_workspace)?;
    let posicion = ws
        .tabs
        .iter()
        .position(|t| Some(*t) == navegador.active_tab)?;
    let total = ws.tabs.len() as isize;
    ws.tabs
        .get((posicion as isize + delta).rem_euclid(total) as usize)
        .copied()
}

fn cargar_bloqueador(ui: &Ui, carpeta_listas: PathBuf) {
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

    let u = ui.clone();
    glib::timeout_add_local(Duration::from_millis(250), move || match rx.try_recv() {
        Ok(Ok(bloques)) => {
            u.estado.borrow().motor.instalar_filtros(&bloques);
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
