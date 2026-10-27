//! Capa de motor web. Es la única que conoce el crate `servo`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use euclid::Scale;
use servo::{
    Code, DevicePoint, InputEvent, KeyState, KeyboardEvent, LoadStatus, Location, Modifiers,
    MouseButtonAction, MouseButtonEvent, MouseMoveEvent, RenderingContext, Servo, ServoBuilder,
    WebView, WebViewBuilder, WebViewDelegate, WheelDelta, WheelEvent, WheelMode,
};
pub use servo::{EventLoopWaker, WebViewId, WindowRenderingContext};
use url::Url;
use winit::dpi::PhysicalSize;
use winit::event::MouseButton;
use winit::keyboard::{Key, ModifiersState, NamedKey};

const PIXELES_POR_LINEA: f64 = 76.0;

#[derive(Debug, Clone, PartialEq)]
pub enum EngineEvent {
    TitleChanged {
        view: WebViewId,
        title: Option<String>,
    },
    UrlChanged {
        view: WebViewId,
        url: String,
    },
    LoadingChanged {
        view: WebViewId,
        loading: bool,
    },
    Closed(WebViewId),
}

type Cola = Rc<RefCell<Vec<EngineEvent>>>;

struct Delegate {
    cola: Cola,
    redibujar: Rc<dyn Fn()>,
}

impl Delegate {
    fn emitir(&self, evento: EngineEvent) {
        self.cola.borrow_mut().push(evento);
    }
}

impl WebViewDelegate for Delegate {
    fn notify_url_changed(&self, webview: WebView, url: Url) {
        self.emitir(EngineEvent::UrlChanged {
            view: webview.id(),
            url: url.to_string(),
        });
    }

    fn notify_page_title_changed(&self, webview: WebView, title: Option<String>) {
        self.emitir(EngineEvent::TitleChanged {
            view: webview.id(),
            title,
        });
    }

    fn notify_load_status_changed(&self, webview: WebView, status: LoadStatus) {
        self.emitir(EngineEvent::LoadingChanged {
            view: webview.id(),
            loading: !matches!(status, LoadStatus::Complete),
        });
    }

    fn notify_new_frame_ready(&self, _webview: WebView) {
        (self.redibujar)();
    }

    fn notify_closed(&self, webview: WebView) {
        self.emitir(EngineEvent::Closed(webview.id()));
    }
}

pub struct Engine {
    servo: Servo,
    contexto: Rc<WindowRenderingContext>,
    vistas: HashMap<WebViewId, WebView>,
    cola: Cola,
    redibujar: Rc<dyn Fn()>,
    escala: f32,
}

impl Engine {
    pub fn new(
        contexto: Rc<WindowRenderingContext>,
        waker: Box<dyn EventLoopWaker>,
        redibujar: Rc<dyn Fn()>,
        escala: f32,
    ) -> Self {
        let _ = contexto.make_current();
        let servo = ServoBuilder::default().event_loop_waker(waker).build();
        servo.setup_logging();
        Self {
            servo,
            contexto,
            vistas: HashMap::new(),
            cola: Rc::default(),
            redibujar,
            escala,
        }
    }

    pub fn create_view(&mut self, url: &Url) -> WebViewId {
        let delegate = Rc::new(Delegate {
            cola: self.cola.clone(),
            redibujar: self.redibujar.clone(),
        });
        let webview = WebViewBuilder::new(&self.servo, self.contexto.clone())
            .url(url.clone())
            .hidpi_scale_factor(Scale::new(self.escala))
            .delegate(delegate)
            .build();
        let id = webview.id();
        self.vistas.insert(id, webview);
        id
    }

    pub fn load(&self, id: WebViewId, url: &Url) {
        if let Some(vista) = self.vistas.get(&id) {
            vista.load(url.clone());
        }
    }

    pub fn reload(&self, id: WebViewId) {
        if let Some(vista) = self.vistas.get(&id) {
            vista.reload();
        }
    }

    pub fn go_back(&self, id: WebViewId) {
        if let Some(vista) = self.vistas.get(&id) {
            let _ = vista.go_back(1);
        }
    }

    pub fn go_forward(&self, id: WebViewId) {
        if let Some(vista) = self.vistas.get(&id) {
            let _ = vista.go_forward(1);
        }
    }

    pub fn paint(&self, id: WebViewId) {
        if let Some(vista) = self.vistas.get(&id) {
            vista.paint();
        }
    }

    pub fn resize(&self, tamano: PhysicalSize<u32>) {
        for vista in self.vistas.values() {
            vista.resize(tamano);
        }
    }

    pub fn close(&mut self, id: WebViewId) {
        self.vistas.remove(&id);
    }

    pub fn spin(&self) {
        self.servo.spin_event_loop();
    }

    pub fn present(&self) {
        self.contexto.present();
    }

    pub fn drain_events(&mut self) -> Vec<EngineEvent> {
        std::mem::take(&mut *self.cola.borrow_mut())
    }

    pub fn mover_raton(&self, id: WebViewId, x: f64, y: f64) {
        self.enviar(id, InputEvent::MouseMove(MouseMoveEvent::new(punto(x, y))));
    }

    pub fn boton_raton(&self, id: WebViewId, x: f64, y: f64, pulsado: bool, boton: MouseButton) {
        let accion = if pulsado {
            MouseButtonAction::Down
        } else {
            MouseButtonAction::Up
        };
        let boton = match boton {
            MouseButton::Left => servo::MouseButton::Primary,
            MouseButton::Right => servo::MouseButton::Secondary,
            MouseButton::Middle => servo::MouseButton::Auxiliary,
            MouseButton::Back => servo::MouseButton::Back,
            MouseButton::Forward => servo::MouseButton::Forward,
            MouseButton::Other(n) => servo::MouseButton::Other(n),
        };
        self.enviar(
            id,
            InputEvent::MouseButton(MouseButtonEvent::new(accion, boton, punto(x, y))),
        );
    }

    pub fn rueda(&self, id: WebViewId, x: f64, y: f64, dx: f64, dy: f64, por_lineas: bool) {
        let (dx, dy, modo) = if por_lineas {
            (
                dx * PIXELES_POR_LINEA,
                dy * PIXELES_POR_LINEA,
                WheelMode::DeltaLine,
            )
        } else {
            (dx, dy, WheelMode::DeltaPixel)
        };
        let delta = WheelDelta {
            x: dx,
            y: dy,
            z: 0.0,
            mode: modo,
        };
        self.enviar(id, InputEvent::Wheel(WheelEvent::new(delta, punto(x, y))));
    }

    pub fn tecla(&self, id: WebViewId, pulsada: bool, tecla: &Key, modificadores: ModifiersState) {
        let Some(tecla) = convertir_tecla(tecla) else {
            return;
        };
        let estado = if pulsada {
            KeyState::Down
        } else {
            KeyState::Up
        };
        let evento = KeyboardEvent::new_without_event(
            estado,
            tecla,
            Code::Unidentified,
            Location::Standard,
            convertir_modificadores(modificadores),
            false,
            false,
        );
        self.enviar(id, InputEvent::Keyboard(evento));
    }

    fn enviar(&self, id: WebViewId, evento: InputEvent) {
        if let Some(vista) = self.vistas.get(&id) {
            vista.notify_input_event(evento);
        }
    }
}

fn punto(x: f64, y: f64) -> servo::WebViewPoint {
    DevicePoint::new(x as f32, y as f32).into()
}

fn convertir_tecla(tecla: &Key) -> Option<servo::Key> {
    match tecla {
        Key::Character(c) => Some(servo::Key::Character(c.to_string())),
        Key::Named(NamedKey::Space) => Some(servo::Key::Character(" ".into())),
        Key::Named(nombrada) => {
            let nombrada = match nombrada {
                NamedKey::Enter => servo::NamedKey::Enter,
                NamedKey::Tab => servo::NamedKey::Tab,
                NamedKey::Backspace => servo::NamedKey::Backspace,
                NamedKey::Delete => servo::NamedKey::Delete,
                NamedKey::Escape => servo::NamedKey::Escape,
                NamedKey::ArrowLeft => servo::NamedKey::ArrowLeft,
                NamedKey::ArrowRight => servo::NamedKey::ArrowRight,
                NamedKey::ArrowUp => servo::NamedKey::ArrowUp,
                NamedKey::ArrowDown => servo::NamedKey::ArrowDown,
                NamedKey::Home => servo::NamedKey::Home,
                NamedKey::End => servo::NamedKey::End,
                NamedKey::PageUp => servo::NamedKey::PageUp,
                NamedKey::PageDown => servo::NamedKey::PageDown,
                _ => return None,
            };
            Some(servo::Key::Named(nombrada))
        }
        _ => None,
    }
}

fn convertir_modificadores(estado: ModifiersState) -> Modifiers {
    let mut modificadores = Modifiers::empty();
    modificadores.set(Modifiers::CONTROL, estado.control_key());
    modificadores.set(Modifiers::SHIFT, estado.shift_key());
    modificadores.set(Modifiers::ALT, estado.alt_key());
    modificadores.set(Modifiers::META, estado.super_key());
    modificadores
}
