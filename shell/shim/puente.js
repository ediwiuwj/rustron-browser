// Puente con Rust (lado JS). Rust entrega mensajes JSON llamando a
// `window.__rustronRecibir(texto)`; la UI responde con `transporte(texto)`, que en
// WebKitGTK es `window.webkit.messageHandlers.rustron.postMessage`.
//
// Mantiene un espejo del estado (pestañas, espacios) para que gBrowser (M4) lo lea
// sin pedirle nada a Rust, y reparte los eventos a quien se suscriba.

export class Puente {
  #transporte;
  #limiteMs;
  #oyentes = new Map();
  #pendientes = new Map();
  #siguienteId = 1;

  // Espejo del estado. `pestanas` se busca por id; el orden de las pestañas lo da
  // `espacios[].pestanas` (usa `pestanasDe`), que es lo que cambia al reordenar o mover.
  pestanas = new Map();
  espacios = [];
  espacioActivo = null;
  pestanaActiva = null;
  interfaz = { barraVisible: true, compacto: false, barraUrlAbierta: false };
  listo = false;

  // limiteMs: tiempo máximo de espera de una petición antes de rechazarla.
  constructor(transporte, { limiteMs = 30_000 } = {}) {
    this.#transporte = transporte;
    this.#limiteMs = limiteMs;
  }

  // Pestañas de un espacio en el orden que fija Rust (por defecto, el del espacio activo).
  pestanasDe(idEspacio = this.espacioActivo) {
    const espacio = this.espacios.find((e) => e.id === idEspacio);
    return (espacio?.pestanas ?? []).map((id) => this.pestanas.get(id)).filter(Boolean);
  }

  // Avisa a Rust de que la UI está lista; Rust responde con la instantánea completa.
  conectar() {
    this.#transporte(JSON.stringify({ tipo: "listo" }));
  }

  accion(nombre, argumentos = {}) {
    this.#transporte(JSON.stringify({ tipo: "accion", accion: { nombre, ...argumentos } }));
  }

  // Petición con respuesta: devuelve una promesa que Rust resuelve o rechaza.
  peticion(metodo, args = {}) {
    const id = this.#siguienteId++;
    return new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        this.#pendientes.delete(id);
        rechazar(new Error(`La petición "${metodo}" no obtuvo respuesta en ${this.#limiteMs} ms`));
      }, this.#limiteMs);
      this.#pendientes.set(id, {
        resolver: (valor) => (clearTimeout(temporizador), resolver(valor)),
        rechazar: (error) => (clearTimeout(temporizador), rechazar(error)),
      });
      this.#transporte(JSON.stringify({ tipo: "peticion", id, metodo, args }));
    });
  }

  // Devuelve una función para darse de baja.
  on(tipo, oyente) {
    if (!this.#oyentes.has(tipo)) {
      this.#oyentes.set(tipo, new Set());
    }
    this.#oyentes.get(tipo).add(oyente);
    return () => this.#oyentes.get(tipo)?.delete(oyente);
  }

  recibir(texto) {
    const mensaje = JSON.parse(texto);
    if (mensaje.tipo === "respuesta") {
      this.#responder(mensaje);
      return;
    }
    this.#actualizarEspejo(mensaje);
    for (const oyente of [...(this.#oyentes.get(mensaje.tipo) ?? [])]) {
      oyente(mensaje);
    }
  }

  #responder({ id, ok, valor, error }) {
    const pendiente = this.#pendientes.get(id);
    if (!pendiente) {
      return;
    }
    this.#pendientes.delete(id);
    if (ok) {
      pendiente.resolver(valor);
    } else {
      pendiente.rechazar(new Error(error));
    }
  }

  #actualizarEspejo(mensaje) {
    switch (mensaje.tipo) {
      case "instantanea": {
        const e = mensaje.estado;
        this.pestanas = new Map(e.pestanas.map((p) => [p.id, p]));
        this.espacios = e.espacios;
        this.espacioActivo = e.espacioActivo;
        this.pestanaActiva = e.pestanaActiva;
        this.interfaz = {
          barraVisible: e.barraVisible,
          compacto: e.compacto,
          barraUrlAbierta: e.barraUrlAbierta,
        };
        this.listo = true;
        break;
      }
      case "pestana-creada":
      case "pestana-actualizada":
        this.pestanas.set(mensaje.pestana.id, mensaje.pestana);
        break;
      case "pestana-cerrada":
        this.pestanas.delete(mensaje.id);
        break;
      case "espacios":
        this.espacios = mensaje.espacios;
        break;
      case "espacio-activado":
        this.espacioActivo = mensaje.id;
        break;
      case "pestana-activada":
        this.pestanaActiva = mensaje.id;
        break;
      case "interfaz":
        this.interfaz = {
          barraVisible: mensaje.barraVisible,
          compacto: mensaje.compacto,
          barraUrlAbierta: mensaje.barraUrlAbierta,
        };
        break;
    }
  }
}

// Almacenamiento de JSONFile (M1) respaldado por Rust. Solo asíncrono: la lectura
// síncrona (ensureDataReady) no puede cruzar el puente.
export function almacenamientoRemoto(puente) {
  return {
    leer: (ruta) => puente.peticion("leer", { ruta }),
    escribir: (ruta, texto) => puente.peticion("escribir", { ruta, texto }),
  };
}

// Conecta el puente a la ventana de WebKitGTK.
export function instalarEnVentana(ventana) {
  const manejador = ventana.webkit?.messageHandlers?.rustron;
  if (!manejador) {
    throw new Error("No hay manejador de mensajes `rustron`: ¿se ejecuta dentro de Rustron?");
  }
  const puente = new Puente((texto) => manejador.postMessage(texto));
  ventana.__rustronRecibir = (texto) => puente.recibir(texto);
  return puente;
}
