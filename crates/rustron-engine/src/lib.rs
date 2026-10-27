//! Capa de motor web. Es la única que conoce el crate `servo`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use euclid::Scale;
pub use servo::{EventLoopWaker, WebViewId, WindowRenderingContext};
use servo::{
    LoadStatus, RenderingContext, Servo, ServoBuilder, WebView, WebViewBuilder, WebViewDelegate,
};
use url::Url;
use winit::dpi::PhysicalSize;

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
}
