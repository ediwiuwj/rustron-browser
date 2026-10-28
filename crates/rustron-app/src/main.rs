use std::cell::RefCell;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;

use gtk4::gdk;
use gtk4::gio;
use gtk4::glib::{self, ControlFlow, Propagation};
use gtk4::pango;
use gtk4::prelude::*;
use rustron_core::{Action, Browser, Effect, EngineEvent, TabId, WorkspaceId};
use rustron_engine::{LoadEvent, Motor, WebView};
use rustron_theme::Paleta;
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
    vigilancia: Option<gio::FileMonitor>,
}

#[derive(Clone)]
struct Ui {
    estado: Rc<RefCell<Estado>>,
    ventana: gtk4::ApplicationWindow,
    barra_lateral: gtk4::Box,
    espacio: gtk4::Label,
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
    let estado = Rc::new(RefCell::new(Estado {
        navegador: Browser::new(),
        vistas: HashMap::new(),
        motor: Motor::new(&datos.join("filtros")),
        vigilancia: None,
    }));

    let ventana = gtk4::ApplicationWindow::builder()
        .application(app)
        .title("Rustron")
        .default_width(1200)
        .default_height(760)
        .build();

    let barra_lateral = gtk4::Box::new(gtk4::Orientation::Vertical, 4);
    barra_lateral.add_css_class("barra-lateral");
    barra_lateral.set_width_request(240);
    barra_lateral.set_hexpand(false);
    barra_lateral.set_halign(gtk4::Align::Start);

    let controles = gtk4::Box::new(gtk4::Orientation::Horizontal, 2);
    let menu = boton_icono("view-more-symbolic");
    let alternar_barra = boton_icono("sidebar-show-symbolic");
    let atras = boton_icono("go-previous-symbolic");
    let adelante = boton_icono("go-next-symbolic");
    let recargar = boton_icono("view-refresh-symbolic");
    let relleno = gtk4::Box::new(gtk4::Orientation::Horizontal, 0);
    relleno.set_hexpand(true);
    controles.append(&menu);
    controles.append(&alternar_barra);
    controles.append(&relleno);
    controles.append(&atras);
    controles.append(&adelante);
    controles.append(&recargar);
    barra_lateral.append(&controles);

    let pastilla = gtk4::Box::new(gtk4::Orientation::Horizontal, 8);
    pastilla.add_css_class("pill");
    let lupa = gtk4::Image::from_icon_name("system-search-symbolic");
    lupa.add_css_class("icono");
    let url = gtk4::Entry::builder()
        .hexpand(true)
        .has_frame(false)
        .placeholder_text("Buscar...")
        .build();
    pastilla.append(&lupa);
    pastilla.append(&url);
    barra_lateral.append(&pastilla);

    let espacio = gtk4::Label::new(None);
    espacio.add_css_class("workspace");
    espacio.set_xalign(0.0);
    barra_lateral.append(&espacio);

    let separador = gtk4::Separator::new(gtk4::Orientation::Horizontal);
    separador.add_css_class("separador");
    barra_lateral.append(&separador);

    let nueva_fila = fila_fija("list-add-symbolic", "Nueva pestaña");
    let ajustes_fila = fila_fija("emblem-system-symbolic", "Ajustes");
    barra_lateral.append(&nueva_fila);
    barra_lateral.append(&ajustes_fila);

    let lista = gtk4::Box::new(gtk4::Orientation::Vertical, 2);
    let desplazable = gtk4::ScrolledWindow::builder()
        .vexpand(true)
        .child(&lista)
        .build();
    barra_lateral.append(&desplazable);

    let barra_inferior = gtk4::Box::new(gtk4::Orientation::Horizontal, 2);
    barra_inferior.add_css_class("barra-inferior");
    let icono_espacios = boton_icono("view-grid-symbolic");
    let relleno_inferior = gtk4::Box::new(gtk4::Orientation::Horizontal, 0);
    relleno_inferior.set_hexpand(true);
    let mas = boton_icono("list-add-symbolic");
    barra_inferior.append(&icono_espacios);
    barra_inferior.append(&relleno_inferior);
    barra_inferior.append(&mas);
    barra_lateral.append(&barra_inferior);

    let pila = gtk4::Stack::builder().hexpand(true).vexpand(true).build();
    pila.add_css_class("tarjeta");
    pila.set_overflow(gtk4::Overflow::Hidden);
    let contenido = gtk4::Box::new(gtk4::Orientation::Vertical, 0);
    contenido.add_css_class("contenido");
    contenido.set_hexpand(true);
    contenido.append(&pila);

    let raiz = gtk4::Box::new(gtk4::Orientation::Horizontal, 0);
    raiz.append(&barra_lateral);
    raiz.append(&contenido);
    ventana.set_child(Some(&raiz));

    let ui = Ui {
        estado,
        ventana: ventana.clone(),
        barra_lateral,
        espacio,
        lista,
        pila,
        url: url.clone(),
    };

    let accion = |boton: &gtk4::Button, accion: fn(&Ui) -> Action| {
        let u = ui.clone();
        boton.connect_clicked(move |_| ejecutar(&u, accion(&u)));
    };
    accion(&nueva_fila, |_| Action::NewTab {
        uri: None,
        workspace: None,
    });
    accion(&mas, |_| Action::NewTab {
        uri: None,
        workspace: None,
    });
    accion(&alternar_barra, |_| Action::ToggleSidebar);
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

    cargar_tema(&ui);

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

fn boton_icono(nombre: &str) -> gtk4::Button {
    let boton = gtk4::Button::from_icon_name(nombre);
    boton.add_css_class("boton-icono");
    boton.add_css_class("flat");
    boton.set_focus_on_click(false);
    boton.set_can_focus(false);
    boton
}

fn fila_fija(icono: &str, texto: &str) -> gtk4::Button {
    let contenido = gtk4::Box::new(gtk4::Orientation::Horizontal, 10);
    let imagen = gtk4::Image::from_icon_name(icono);
    imagen.add_css_class("fila-suave");
    let etiqueta = gtk4::Label::new(Some(texto));
    etiqueta.set_xalign(0.0);
    contenido.append(&imagen);
    contenido.append(&etiqueta);
    let boton = gtk4::Button::new();
    boton.set_child(Some(&contenido));
    boton.add_css_class("flat");
    boton.add_css_class("fila");
    boton.add_css_class("fila-suave");
    boton
}

fn cargar_tema(ui: &Ui) {
    let Some(pantalla) = gdk::Display::default() else {
        return;
    };
    let proveedor = gtk4::CssProvider::new();
    gtk4::style_context_add_provider_for_display(
        &pantalla,
        &proveedor,
        gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION,
    );
    let ruta = glib::home_dir().join(".local/state/caelestia/scheme.json");
    aplicar_css(&proveedor, &ruta);

    let archivo = gio::File::for_path(&ruta);
    if let Ok(monitor) =
        archivo.monitor_file(gio::FileMonitorFlags::NONE, None::<&gio::Cancellable>)
    {
        let p = proveedor.clone();
        let r = ruta.clone();
        monitor.connect_changed(move |_, _, _, evento| {
            if evento == gio::FileMonitorEvent::ChangesDoneHint {
                aplicar_css(&p, &r);
            }
        });
        ui.estado.borrow_mut().vigilancia = Some(monitor);
    }
}

fn aplicar_css(proveedor: &gtk4::CssProvider, ruta: &PathBuf) {
    let paleta = fs::read_to_string(ruta)
        .ok()
        .and_then(|texto| Paleta::desde_scheme(&texto).ok())
        .unwrap_or_else(Paleta::por_defecto);
    proveedor.load_from_data(&paleta.css());
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
    let (pestanas, activa, uri_activa, barra_visible, nombre_espacio, titulo_ventana) = {
        let estado = ui.estado.borrow();
        let navegador = &estado.navegador;
        let ws = navegador.workspace(navegador.active_workspace);
        let ids: Vec<TabId> = ws.map(|w| w.tabs.clone()).unwrap_or_default();
        let nombre_espacio = ws.map(|w| w.name.clone()).unwrap_or_default();
        let pestanas: Vec<(TabId, String)> = ids
            .iter()
            .filter_map(|id| navegador.tab(*id))
            .map(|t| (t.id, texto_de(t)))
            .collect();
        let activa = navegador.active_tab;
        let uri_activa = activa
            .and_then(|id| navegador.tab(id))
            .map(|t| t.uri.clone())
            .unwrap_or_default();
        let titulo = activa
            .and_then(|id| navegador.tab(id))
            .map(texto_de)
            .unwrap_or_default();
        let titulo_ventana = format!("Rustron — {titulo}");
        (
            pestanas,
            activa,
            uri_activa,
            navegador.sidebar_visible,
            nombre_espacio,
            titulo_ventana,
        )
    };

    while let Some(hijo) = ui.lista.first_child() {
        ui.lista.remove(&hijo);
    }
    for (id, texto) in pestanas {
        let fila = fila_pestana(&texto, Some(id) == activa);
        let u = ui.clone();
        fila.connect_clicked(move |_| ejecutar(&u, Action::ActivateTab(id)));
        ui.lista.append(&fila);
    }

    if let Some(tab) = activa {
        ui.pila.set_visible_child_name(&nombre_vista(tab));
    }
    if !ui.url.has_focus() {
        ui.url.set_text(&uri_activa);
    }
    ui.espacio.set_text(&nombre_espacio);
    ui.barra_lateral.set_visible(barra_visible);
    ui.ventana.set_title(Some(&titulo_ventana));
}

fn texto_de(tab: &rustron_core::Tab) -> String {
    if tab.title.is_empty() {
        tab.uri.clone()
    } else {
        tab.title.clone()
    }
}

fn fila_pestana(texto: &str, activa: bool) -> gtk4::Button {
    let contenido = gtk4::Box::new(gtk4::Orientation::Horizontal, 10);
    let icono = gtk4::Image::from_icon_name("web-browser-symbolic");
    icono.add_css_class("fila-suave");
    let etiqueta = gtk4::Label::new(Some(texto));
    etiqueta.set_xalign(0.0);
    etiqueta.set_hexpand(true);
    etiqueta.set_ellipsize(pango::EllipsizeMode::End);
    contenido.append(&icono);
    contenido.append(&etiqueta);
    let boton = gtk4::Button::new();
    boton.set_child(Some(&contenido));
    boton.add_css_class("flat");
    boton.add_css_class("fila");
    if activa {
        boton.add_css_class("activa");
    }
    boton
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
