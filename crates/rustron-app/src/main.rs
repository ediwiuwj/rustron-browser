use std::cell::RefCell;
use std::error::Error;
use std::rc::Rc;

use euclid::Scale;
use rustron_engine::servo::{
    EventLoopWaker, RenderingContext, Servo, ServoBuilder, WebView, WebViewBuilder,
    WebViewDelegate, WindowRenderingContext,
};
use url::Url;
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use winit::window::{Window, WindowId};

const URL_POR_DEFECTO: &str = "https://example.com";

fn main() -> Result<(), Box<dyn Error>> {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("No se pudo instalar el proveedor criptográfico");

    let url = Url::parse(&std::env::args().nth(1).unwrap_or_else(|| URL_POR_DEFECTO.into()))?;

    let event_loop = EventLoop::with_user_event().build()?;
    let mut app = App::new(&event_loop, url);
    event_loop.run_app(&mut app)?;
    Ok(())
}

struct Estado {
    window: Window,
    servo: Servo,
    contexto: Rc<WindowRenderingContext>,
    webviews: RefCell<Vec<WebView>>,
}

impl WebViewDelegate for Estado {
    fn notify_new_frame_ready(&self, _: WebView) {
        self.window.request_redraw();
    }
}

enum App {
    Inicial(Waker, Url),
    Ejecutando(Rc<Estado>),
}

impl App {
    fn new(event_loop: &EventLoop<WakerEvent>, url: Url) -> Self {
        Self::Inicial(Waker::new(event_loop), url)
    }
}

impl ApplicationHandler<WakerEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if let Self::Inicial(waker, url) = self {
            let display_handle = event_loop
                .display_handle()
                .expect("No se pudo obtener el display");
            let window = event_loop
                .create_window(Window::default_attributes().with_title("Rustron"))
                .expect("No se pudo crear la ventana");
            let window_handle = window.window_handle().expect("No se pudo obtener la ventana");

            let contexto = Rc::new(
                WindowRenderingContext::new(display_handle, window_handle, window.inner_size())
                    .expect("No se pudo crear el contexto de render"),
            );
            let _ = contexto.make_current();

            let servo = ServoBuilder::default()
                .event_loop_waker(Box::new(waker.clone()))
                .build();
            servo.setup_logging();

            let estado = Rc::new(Estado {
                window,
                servo,
                contexto,
                webviews: Default::default(),
            });

            let webview = WebViewBuilder::new(&estado.servo, estado.contexto.clone())
                .url(url.clone())
                .hidpi_scale_factor(Scale::new(estado.window.scale_factor() as f32))
                .delegate(estado.clone())
                .build();

            estado.webviews.borrow_mut().push(webview);
            *self = Self::Ejecutando(estado);
        }
    }

    fn user_event(&mut self, _event_loop: &ActiveEventLoop, _event: WakerEvent) {
        if let Self::Ejecutando(estado) = self {
            estado.servo.spin_event_loop();
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if let Self::Ejecutando(estado) = self {
            estado.servo.spin_event_loop();
        }

        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::RedrawRequested => {
                if let Self::Ejecutando(estado) = self {
                    if let Some(webview) = estado.webviews.borrow().last() {
                        webview.paint();
                    }
                    estado.contexto.present();
                }
            }
            WindowEvent::Resized(nuevo_tamano) => {
                if let Self::Ejecutando(estado) = self {
                    if let Some(webview) = estado.webviews.borrow().last() {
                        webview.resize(nuevo_tamano);
                    }
                }
            }
            _ => (),
        }
    }
}

#[derive(Clone)]
struct Waker(winit::event_loop::EventLoopProxy<WakerEvent>);

#[derive(Debug)]
struct WakerEvent;

impl Waker {
    fn new(event_loop: &EventLoop<WakerEvent>) -> Self {
        Self(event_loop.create_proxy())
    }
}

impl EventLoopWaker for Waker {
    fn clone_box(&self) -> Box<dyn EventLoopWaker> {
        Box::new(Self(self.0.clone()))
    }

    fn wake(&self) {
        let _ = self.0.send_event(WakerEvent);
    }
}
