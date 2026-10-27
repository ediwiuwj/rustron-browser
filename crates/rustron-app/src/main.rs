use std::collections::HashMap;
use std::error::Error;
use std::rc::Rc;

use rustron_core::{Action, Browser, Effect, EngineEvent as EventoCore, TabId, WorkspaceId};
use rustron_engine::{Engine, EngineEvent, EventLoopWaker, WebViewId, WindowRenderingContext};
use url::Url;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy};
use winit::keyboard::{Key, ModifiersState, NamedKey};
use winit::raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use winit::window::Window;

const URL_POR_DEFECTO: &str = "https://example.com";

fn main() -> Result<(), Box<dyn Error>> {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("No se pudo instalar el proveedor criptográfico");

    let inicio = Url::parse(
        &std::env::args()
            .nth(1)
            .unwrap_or_else(|| URL_POR_DEFECTO.into()),
    )?;

    let event_loop = EventLoop::with_user_event().build()?;
    let mut app = App {
        proxy: event_loop.create_proxy(),
        inicio,
        estado: None,
    };
    event_loop.run_app(&mut app)?;
    Ok(())
}

struct Estado {
    ventana: Rc<Window>,
    motor: Engine,
    navegador: Browser,
    vistas: HashMap<TabId, WebViewId>,
    modificadores: ModifiersState,
    cursor: (f64, f64),
}

impl Estado {
    fn reenviar_tecla(&self, pulsada: bool, tecla: &Key) {
        if let Some(vista) = self.vista_activa() {
            self.motor.tecla(vista, pulsada, tecla, self.modificadores);
        }
    }

    fn ejecutar(&mut self, accion: Action) {
        for efecto in self.navegador.dispatch(accion) {
            self.aplicar(efecto);
        }
        self.sincronizar_vistas();
        if self.navegador.tabs.is_empty() {
            self.ejecutar(Action::NewTab {
                uri: None,
                workspace: None,
            });
        }
        self.actualizar_titulo();
        self.ventana.request_redraw();
    }

    fn aplicar(&mut self, efecto: Effect) {
        match efecto {
            Effect::Navigate { tab, uri } => {
                if let (Some(&vista), Ok(url)) = (self.vistas.get(&tab), Url::parse(&uri)) {
                    self.motor.load(vista, &url);
                }
            }
            Effect::Reload { tab, .. } => {
                if let Some(&vista) = self.vistas.get(&tab) {
                    self.motor.reload(vista);
                }
            }
            Effect::GoBack(tab) => {
                if let Some(&vista) = self.vistas.get(&tab) {
                    self.motor.go_back(vista);
                }
            }
            Effect::GoForward(tab) => {
                if let Some(&vista) = self.vistas.get(&tab) {
                    self.motor.go_forward(vista);
                }
            }
            Effect::Release(tab) => {
                if let Some(vista) = self.vistas.remove(&tab) {
                    self.motor.close(vista);
                }
            }
            Effect::ToggleAdblock { .. } => {}
        }
    }

    fn sincronizar_vistas(&mut self) {
        let pendientes: Vec<(TabId, Url)> = self
            .navegador
            .tabs
            .iter()
            .filter(|t| !self.vistas.contains_key(&t.id))
            .filter_map(|t| Url::parse(&t.uri).ok().map(|url| (t.id, url)))
            .collect();
        for (tab, url) in pendientes {
            let vista = self.motor.create_view(&url);
            self.vistas.insert(tab, vista);
        }
    }

    fn procesar_eventos(&mut self) {
        for evento in self.motor.drain_events() {
            match evento {
                EngineEvent::TitleChanged { view, title } => {
                    if let Some(tab) = self.tab_de(view) {
                        self.navegador.apply_event(EventoCore::TitleChanged {
                            tab,
                            title: title.unwrap_or_default(),
                        });
                    }
                }
                EngineEvent::UrlChanged { view, url } => {
                    if let Some(tab) = self.tab_de(view) {
                        self.navegador
                            .apply_event(EventoCore::UrlChanged { tab, uri: url });
                    }
                }
                EngineEvent::LoadingChanged { view, loading } => {
                    if let Some(tab) = self.tab_de(view) {
                        self.navegador
                            .apply_event(EventoCore::LoadingChanged { tab, loading });
                    }
                }
                EngineEvent::Closed(view) => {
                    if let Some(tab) = self.tab_de(view) {
                        self.vistas.remove(&tab);
                        self.motor.close(view);
                        self.navegador.apply_event(EventoCore::Closed(tab));
                    }
                }
            }
        }
        if self.navegador.tabs.is_empty() {
            self.ejecutar(Action::NewTab {
                uri: None,
                workspace: None,
            });
        }
        self.actualizar_titulo();
    }

    fn tab_de(&self, vista: WebViewId) -> Option<TabId> {
        self.vistas
            .iter()
            .find(|(_, v)| **v == vista)
            .map(|(tab, _)| *tab)
    }

    fn vista_activa(&self) -> Option<WebViewId> {
        self.navegador
            .active_tab
            .and_then(|tab| self.vistas.get(&tab).copied())
    }

    fn pestana_vecina(&self, delta: isize) -> Option<TabId> {
        let ws = self.navegador.workspace(self.navegador.active_workspace)?;
        let actual = ws
            .tabs
            .iter()
            .position(|t| Some(*t) == self.navegador.active_tab)?;
        let total = ws.tabs.len() as isize;
        let nueva = (actual as isize + delta).rem_euclid(total) as usize;
        ws.tabs.get(nueva).copied()
    }

    fn atajo(&self, tecla: &Key) -> Option<Action> {
        let ctrl = self.modificadores.control_key();
        let shift = self.modificadores.shift_key();
        let alt = self.modificadores.alt_key();
        let activa = self.navegador.active_tab;

        match tecla {
            Key::Named(NamedKey::Tab) if ctrl => self
                .pestana_vecina(if shift { -1 } else { 1 })
                .map(Action::ActivateTab),
            Key::Named(NamedKey::ArrowLeft) if alt => activa.map(Action::GoBack),
            Key::Named(NamedKey::ArrowRight) if alt => activa.map(Action::GoForward),
            Key::Character(c) if ctrl => match c.to_lowercase().as_str() {
                "t" => Some(Action::NewTab {
                    uri: None,
                    workspace: None,
                }),
                "w" => activa.map(Action::CloseTab),
                "r" => activa.map(|tab| Action::Reload { tab, hard: shift }),
                "e" if shift => Some(Action::ToggleSidebar),
                "c" if shift => Some(Action::ToggleCompact),
                _ => None,
            },
            Key::Character(c) if alt => c
                .parse::<u64>()
                .ok()
                .filter(|n| (1..=9).contains(n))
                .map(|n| Action::SwitchWorkspace(WorkspaceId(n))),
            _ => None,
        }
    }

    fn actualizar_titulo(&self) {
        let activa = self
            .navegador
            .active_tab
            .and_then(|tab| self.navegador.tab(tab));
        let titulo = activa
            .map(|t| {
                if t.title.is_empty() {
                    t.uri.clone()
                } else {
                    t.title.clone()
                }
            })
            .unwrap_or_default();
        let total = self
            .navegador
            .workspace(self.navegador.active_workspace)
            .map_or(0, |ws| ws.tabs.len());
        self.ventana
            .set_title(&format!("Rustron — {titulo} [{total} pestañas]"));
    }
}

struct App {
    proxy: EventLoopProxy<WakerEvent>,
    inicio: Url,
    estado: Option<Estado>,
}

impl ApplicationHandler<WakerEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.estado.is_some() {
            return;
        }
        let display_handle = event_loop
            .display_handle()
            .expect("No se pudo obtener el display");
        let ventana = Rc::new(
            event_loop
                .create_window(Window::default_attributes().with_title("Rustron"))
                .expect("No se pudo crear la ventana"),
        );
        let window_handle = ventana
            .window_handle()
            .expect("No se pudo obtener la ventana");
        let contexto = Rc::new(
            WindowRenderingContext::new(display_handle, window_handle, ventana.inner_size())
                .expect("No se pudo crear el contexto de render"),
        );

        let ventana_redibujo = ventana.clone();
        let redibujar: Rc<dyn Fn()> = Rc::new(move || ventana_redibujo.request_redraw());
        let escala = ventana.scale_factor() as f32;
        let motor = Engine::new(
            contexto,
            Box::new(Waker(self.proxy.clone())),
            redibujar,
            escala,
        );

        let mut estado = Estado {
            ventana,
            motor,
            navegador: Browser::new(),
            vistas: HashMap::new(),
            modificadores: ModifiersState::empty(),
            cursor: (0.0, 0.0),
        };
        estado.ejecutar(Action::NewTab {
            uri: Some(self.inicio.to_string()),
            workspace: None,
        });
        self.estado = Some(estado);
    }

    fn user_event(&mut self, _event_loop: &ActiveEventLoop, _evento: WakerEvent) {
        if let Some(estado) = self.estado.as_mut() {
            estado.motor.spin();
            estado.procesar_eventos();
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: winit::window::WindowId,
        evento: WindowEvent,
    ) {
        let Some(estado) = self.estado.as_mut() else {
            return;
        };
        estado.motor.spin();

        match evento {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::ModifiersChanged(modificadores) => {
                estado.modificadores = modificadores.state();
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state == ElementState::Pressed {
                    match estado.atajo(&event.logical_key) {
                        Some(accion) => estado.ejecutar(accion),
                        None => estado.reenviar_tecla(true, &event.logical_key),
                    }
                } else {
                    estado.reenviar_tecla(false, &event.logical_key);
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                estado.cursor = (position.x, position.y);
                if let Some(vista) = estado.vista_activa() {
                    estado.motor.mover_raton(vista, position.x, position.y);
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if let Some(vista) = estado.vista_activa() {
                    let (x, y) = estado.cursor;
                    estado
                        .motor
                        .boton_raton(vista, x, y, state == ElementState::Pressed, button);
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                if let Some(vista) = estado.vista_activa() {
                    let (x, y) = estado.cursor;
                    match delta {
                        MouseScrollDelta::LineDelta(dx, dy) => {
                            estado.motor.rueda(vista, x, y, dx as f64, dy as f64, true);
                        }
                        MouseScrollDelta::PixelDelta(p) => {
                            estado.motor.rueda(vista, x, y, p.x, p.y, false);
                        }
                    }
                }
            }
            WindowEvent::RedrawRequested => {
                if let Some(vista) = estado.vista_activa() {
                    estado.motor.paint(vista);
                }
                estado.motor.present();
            }
            WindowEvent::Resized(tamano) => {
                estado.motor.resize(tamano);
                estado.ventana.request_redraw();
            }
            _ => (),
        }
        estado.procesar_eventos();
    }
}

#[derive(Debug)]
struct WakerEvent;

#[derive(Clone)]
struct Waker(EventLoopProxy<WakerEvent>);

impl EventLoopWaker for Waker {
    fn clone_box(&self) -> Box<dyn EventLoopWaker> {
        Box::new(self.clone())
    }

    fn wake(&self) {
        let _ = self.0.send_event(WakerEvent);
    }
}
