// Servicios de Services que la barra de direcciones y Zen usan y que se calculan solos (sin Rust):
// locale, textToSubURI, eTLD, io (partes que faltaban), policies, xulStore, clipboard (tipos), zen.
// Donde Firefox consulta datos que Rustron no tiene (la lista de sufijos públicos, políticas de empresa) se
// dice aquí mismo qué se aproxima.

// Sufijos de dos etiquetas más frecuentes (Firefox usa la lista completa de sufijos públicos, que aquí no hay).
const SUFIJOS_DE_DOS_ETIQUETAS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "ne.jp", "or.jp",
  "com.br", "com.mx", "com.ar", "com.co", "com.pe", "com.ve", "com.cl", "com.uy", "com.es", "com.tr", "com.cn",
  "co.in", "co.kr", "co.za", "com.sg", "com.hk", "com.tw", "github.io", "blogspot.com", "herokuapp.com",
]);

export function crearETLD() {
  const etiquetas = (host) => host.replace(/\.$/, "").toLowerCase().split(".");
  const esIP = (host) => /^[\d.]+$/.test(host) || host.includes(":");
  const sufijo = (host) => {
    const partes = etiquetas(host);
    const dos = partes.slice(-2).join(".");
    return SUFIJOS_DE_DOS_ETIQUETAS.has(dos) ? dos : partes.at(-1);
  };
  const error = () => Object.assign(new Error("NS_ERROR_HOST_IS_IP_ADDRESS"), { result: 0x804b0050 });
  return {
    getKnownPublicSuffixFromHost(host) {
      if (esIP(host)) {
        throw error();
      }
      return sufijo(host);
    },
    getBaseDomainFromHost(host, extra = 0) {
      if (esIP(host)) {
        throw error();
      }
      const partes = etiquetas(host);
      const n = sufijo(host).split(".").length + 1 + extra;
      if (partes.length < n) {
        throw Object.assign(new Error("NS_ERROR_INSUFFICIENT_DOMAIN_LEVELS"), { result: 0x804b0051 });
      }
      return partes.slice(-n).join(".");
    },
    // El "sitio" sin esquema: el dominio base (o el host si es una IP o no tiene suficientes etiquetas).
    getSchemelessSite(uri) {
      const host = uri.host;
      try {
        return this.getBaseDomainFromHost(host);
      } catch {
        return host;
      }
    },
  };
}

// Firefox deja sin descodificar lo que cambiaría el significado de la dirección o es un carácter de control.
const NO_DESCODIFICAR = new Set(["%25", "%2F", "%3F", "%23", "%26", "%3D", "%3A", "%40", "%2B", "%24", "%2C", "%3B"]);
export function crearTextToSubURI() {
  return {
    unEscapeURIForUI(texto) {
      return String(texto).replace(/(?:%[0-9a-f]{2})+/gi, (secuencia) => {
        if (secuencia.length === 3 && NO_DESCODIFICAR.has(secuencia.toUpperCase())) {
          return secuencia;
        }
        try {
          const descodificado = decodeURIComponent(secuencia);
          return /[\u0000-\u001f\u007f]/.test(descodificado) ? secuencia : descodificado;
        } catch {
          return secuencia; // no es UTF-8 válido: se deja como está
        }
      });
    },
  };
}

export function crearLocale(ventana) {
  const idioma = () => ventana.navigator.languages?.[0] ?? ventana.navigator.language ?? "en-US";
  return {
    get appLocaleAsBCP47() {
      return idioma();
    },
    get regionalPrefsLocales() {
      return [idioma()];
    },
    get appLocalesAsBCP47() {
      return [...(ventana.navigator.languages ?? [idioma()])];
    },
    // Lo que se añade a una palabra para completarla con Ctrl+Intro (en el idioma de Firefox, ".com").
    urlFixupSuffix: ".com",
  };
}

// nsIXULStore: tamaños y estados que Zen recuerda entre ejecuciones. Hoy solo viven mientras la ventana.
export function crearXulStore() {
  const datos = new Map();
  const clave = (url, id, atributo) => `${url}\u0000${id}\u0000${atributo}`;
  return {
    getValue: (url, id, atributo) => datos.get(clave(url, id, atributo)) ?? "",
    setValue: (url, id, atributo, valor) => void datos.set(clave(url, id, atributo), String(valor)),
    hasValue: (url, id, atributo) => datos.has(clave(url, id, atributo)),
    removeValue: (url, id, atributo) => void datos.delete(clave(url, id, atributo)),
    persist() {},
  };
}

// Lo que Services.io no tenía: dirección que se puede mostrar (sin usuario ni contraseña) y conexión anticipada.
export function ampliarIO(io, nuevaURI) {
  io.createExposableURI = (uri) => {
    const url = new URL(uri.spec);
    if (!url.username && !url.password) {
      return uri;
    }
    url.username = "";
    url.password = "";
    return nuevaURI(url.href);
  };
  io.speculativeConnect = () => {}; // WebKit decide sus propias conexiones anticipadas
  return io;
}

// nsITimer (`Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer)`): una llamada diferida o repetida.
export const TIPOS_DE_TIMER = { TYPE_ONE_SHOT: 0, TYPE_REPEATING_SLACK: 1, TYPE_REPEATING_PRECISE: 2, TYPE_REPEATING_PRECISE_CAN_SKIP: 3 };
export function crearTimer(ventana) {
  let id = null;
  const timer = {
    delay: 0,
    type: 0,
    callback: null,
    initWithCallback(llamada, retraso, tipo = 0) {
      timer.cancel();
      timer.callback = llamada;
      timer.delay = retraso;
      timer.type = tipo;
      const avisar = () => (typeof llamada === "function" ? llamada(timer) : llamada.notify(timer));
      if (tipo === TIPOS_DE_TIMER.TYPE_ONE_SHOT) {
        id = ventana.setTimeout(() => ((id = null), avisar()), retraso);
      } else {
        id = ventana.setInterval(avisar, retraso);
      }
    },
    init(observador, retraso, tipo = 0) {
      timer.initWithCallback(() => observador.observe(timer, "timer-callback", null), retraso, tipo);
    },
    cancel() {
      if (id !== null) {
        ventana.clearTimeout(id); // clearTimeout y clearInterval comparten identificadores
        id = null;
      }
    },
  };
  return timer;
}

export function crearServiciosDeNavegador(ventana) {
  return {
    locale: crearLocale(ventana),
    textToSubURI: crearTextToSubURI(),
    eTLD: crearETLD(),
    xulStore: crearXulStore(),
    // No hay políticas de empresa: todo está permitido.
    policies: { isAllowed: () => true, getActivePolicies: () => null },
    clipboard: {
      kGlobalClipboard: 0,
      kSelectionClipboard: 1,
      // El portapapeles de selección (clic central) no es de WebKit: solo el global.
      isClipboardTypeSupported: (tipo) => tipo === 0,
    },
    // Servicios propios de Zen: sin vibración háptica ni "compartir" del sistema en Linux.
    zen: { playHapticFeedback() {}, canShare: () => false },
  };
}
