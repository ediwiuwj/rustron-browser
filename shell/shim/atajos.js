// Atajos de teclado: los <key> de los <keyset> de XUL (browser.xhtml, y los que crea Zen) con su comando.
// Firefox los resuelve en C++; aquí se leen del DOM y se comparan con los eventos `keydown`.

const CODIGOS = {
  VK_TAB: "Tab", VK_RETURN: "Enter", VK_ENTER: "Enter", VK_ESCAPE: "Escape", VK_DELETE: "Delete",
  VK_BACK: "Backspace", VK_SPACE: " ", VK_LEFT: "ArrowLeft", VK_RIGHT: "ArrowRight", VK_UP: "ArrowUp",
  VK_DOWN: "ArrowDown", VK_PAGE_UP: "PageUp", VK_PAGE_DOWN: "PageDown", VK_HOME: "Home", VK_END: "End",
  VK_INSERT: "Insert",
};

// `modifiers="accel,shift"`: accel es Ctrl en Linux; `os` y `meta` son la tecla Super.
function modificadores(texto) {
  const lista = (texto ?? "").split(/[\s,]+/).filter(Boolean);
  return {
    ctrl: lista.includes("accel") || lista.includes("control"),
    shift: lista.includes("shift"),
    alt: lista.includes("alt"),
    meta: lista.includes("meta") || lista.includes("os"),
  };
}

// { key, ctrl, shift, alt, meta } a partir de los atributos de un <key>, o null si no es utilizable.
export function normalizarAtajo(atributos) {
  let tecla = atributos.keycode ? CODIGOS[atributos.keycode] ?? (/^VK_F\d+$/.test(atributos.keycode) ? atributos.keycode.slice(3) : null) : atributos.key;
  if (!tecla) {
    return null;
  }
  if (tecla.length === 1) {
    tecla = tecla.toLowerCase();
  }
  return { key: tecla, ...modificadores(atributos.modifiers) };
}

const esLetraODigito = (tecla) => /^[a-z0-9]$/.test(tecla);

// ¿El evento (o un objeto con key/ctrlKey/shiftKey/altKey/metaKey) es este atajo?
// El Shift de un símbolo (como el + de Ctrl++) lo da la propia tecla y no cuenta como modificador.
export function coincide(atajo, evento) {
  let tecla = evento.key;
  if (!tecla) {
    return false;
  }
  if (tecla.length === 1) {
    tecla = tecla.toLowerCase();
  }
  if (tecla !== atajo.key) {
    return false;
  }
  if (!!evento.ctrlKey !== atajo.ctrl || !!evento.altKey !== atajo.alt || !!evento.metaKey !== atajo.meta) {
    return false;
  }
  const comparaShift = atajo.key.length > 1 || esLetraODigito(atajo.key);
  return !comparaShift || !!evento.shiftKey === atajo.shift;
}

// Con el foco en un campo de texto, las teclas sin Ctrl/Alt/Super y las de edición (copiar, pegar...) son
// del campo, no de los atajos.
export function esDeEdicion(evento, campoDeTexto) {
  if (!campoDeTexto) {
    return false;
  }
  if (!evento.ctrlKey && !evento.altKey && !evento.metaKey) {
    return true;
  }
  return evento.ctrlKey && !evento.altKey && !evento.shiftKey && "acvxzy".includes(String(evento.key).toLowerCase());
}

const esCampoDeTexto = (el) =>
  !!el && (el.isContentEditable || ["input", "textarea"].includes(el.localName) || el.localName === "textbox");

// Lee los <key> vigentes del documento (se vuelven a leer al pulsar: Zen puede crearlos más tarde).
export function leerAtajos(documento) {
  const atajos = [];
  for (const el of documento.querySelectorAll("key")) {
    if (el.getAttribute("disabled") === "true" || (!el.hasAttribute("command") && !el.hasAttribute("oncommand"))) {
      continue;
    }
    const atajo = normalizarAtajo({
      key: el.getAttribute("key"),
      keycode: el.getAttribute("keycode"),
      modifiers: el.getAttribute("modifiers"),
    });
    if (atajo) {
      atajos.push({ ...atajo, elemento: el });
    }
  }
  return atajos;
}

// Instala el oyente de `keydown`. `ejecutar(elemento, evento)` ejecuta el comando de la tecla.
// Devuelve `{ lista(), procesar(evento) }`: `procesar` sirve también para teclas que llegan de Rust.
export function instalarAtajos(ventana, ejecutar) {
  const documento = ventana.document;
  const procesar = (evento) => {
    const foco = documento.activeElement ?? evento.target;
    if (esDeEdicion(evento, esCampoDeTexto(foco) || esCampoDeTexto(evento.target))) {
      return false;
    }
    for (const atajo of leerAtajos(documento)) {
      if (coincide(atajo, evento)) {
        return ejecutar(atajo.elemento, evento) !== false;
      }
    }
    return false;
  };
  ventana.addEventListener(
    "keydown",
    (evento) => {
      if (procesar(evento)) {
        evento.preventDefault();
        evento.stopPropagation();
      }
    },
    true
  );
  return {
    // La lista sin elementos, para avisar a Rust de las teclas que debe vigilar con el foco en una página web.
    lista: () => leerAtajos(documento).map(({ elemento, ...atajo }) => atajo),
    procesar,
  };
}
