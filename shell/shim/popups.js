// Menús y paneles (popups) de XUL. En Firefox son ventanas del sistema colocadas por el motor; aquí son
// elementos `position: fixed` que se colocan junto a su ancla, se cierran al hacer clic fuera o con Escape,
// y avisan a Rust de lo que tapan (la vista de la pestaña web va encima de la interfaz y los taparía).

const MARGEN = 4; // separación mínima con el borde de la ventana

// Esquina donde se abre un popup respecto a su ancla, con los nombres de posición de XUL
// (`after_start`: debajo y alineado a la izquierda; `end_before`: a la derecha y alineado arriba...).
// Devuelve { left, top } en píxeles de la ventana, sin salirse de ella.
export function calcularPosicion({ ancla, popup, ventana, posicion = "", x = 0, y = 0 }) {
  let left = x;
  let top = y;
  if (ancla) {
    const [lado, alineacion] = posicion.split("_");
    const derecha = ancla.x + ancla.width;
    const abajo = ancla.y + ancla.height;
    switch (posicion) {
      case "overlap":
        left = ancla.x + x;
        top = ancla.y + y;
        break;
      case "after_pointer":
        left = x;
        top = y;
        break;
      default: {
        // before/after: encima o debajo; start/end: a un lado.
        if (lado === "before" || lado === "after") {
          top = (lado === "before" ? ancla.y - popup.height : abajo) + y;
          left = (alineacion === "end" ? derecha - popup.width : ancla.x) + x;
        } else if (lado === "start" || lado === "end") {
          left = (lado === "start" ? ancla.x - popup.width : derecha) + x;
          top = (alineacion === "after" ? abajo - popup.height : ancla.y) + y;
        } else {
          left = ancla.x + x;
          top = abajo + y;
        }
      }
    }
    // Si no cabe debajo/a la derecha, se pasa al lado contrario (como hace el motor).
    if (lado === "after" && top + popup.height > ventana.height - MARGEN && ancla.y - popup.height >= MARGEN) {
      top = ancla.y - popup.height - y;
    }
    if (lado === "end" && left + popup.width > ventana.width - MARGEN && ancla.x - popup.width >= MARGEN) {
      left = ancla.x - popup.width - x;
    }
  }
  left = Math.min(Math.max(left, MARGEN), Math.max(MARGEN, ventana.width - popup.width - MARGEN));
  top = Math.min(Math.max(top, MARGEN), Math.max(MARGEN, ventana.height - popup.height - MARGEN));
  return { left: Math.round(left), top: Math.round(top) };
}

const ES_POPUP = "menupopup, panel, tooltip";
const abiertos = (documento) => [...documento.querySelectorAll('menupopup[state="open"], panel[state="open"]')];

// ¿Se solapan dos rectángulos { x, y, width, height }?
export const seSolapan = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function instalarPopups(ventana, { avisar = () => {} } = {}) {
  const documento = ventana.document;
  let suprimirClic = null;
  let ultimoAviso = "";

  // Rust necesita saber qué rectángulos cubren popups para dejar al descubierto la interfaz.
  const aRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), ancho: Math.round(r.width), alto: Math.round(r.height) });
  const avisarCubiertos = () => {
    const rects = abiertos(documento).map((p) => aRect(p.getBoundingClientRect()));
    // La barra de direcciones expandida (la flotante de Zen y su lista de resultados) también se abre sobre la página.
    const barra = documento.getElementById("urlbar");
    if (barra?.hasAttribute("breakout-extend")) {
      rects.push(aRect(barra.getBoundingClientRect()));
      const lista = barra.querySelector(".urlbarView");
      if (lista) {
        rects.push(aRect(lista.getBoundingClientRect()));
      }
    }
    const texto = JSON.stringify(rects);
    if (texto !== ultimoAviso) {
      ultimoAviso = texto;
      avisar({ tipo: "popups", rects });
    }
  };

  const colocar = (popup, ancla, posicion, x, y) => {
    const r = popup.getBoundingClientRect();
    const a = ancla?.getBoundingClientRect?.();
    const { left, top } = calcularPosicion({
      ancla: a && { x: a.x, y: a.y, width: a.width, height: a.height },
      popup: { width: r.width, height: r.height },
      ventana: { width: ventana.innerWidth, height: ventana.innerHeight },
      posicion: posicion ?? "",
      x,
      y,
    });
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    avisarCubiertos();
  };

  // Al abrirse, los elementos con `data-lazy-l10n-id` (traducción diferida) pasan a `data-l10n-id` y se traducen.
  // Va en la fase de burbujeo: los oyentes de Zen que ponen argumentos (`data-l10n-args`) ya han corrido.
  documento.addEventListener("popupshowing", (evento) => {
    const menu = evento.target;
    for (const el of menu.querySelectorAll?.("[data-lazy-l10n-id]") ?? []) {
      el.setAttribute("data-l10n-id", el.getAttribute("data-lazy-l10n-id"));
      el.removeAttribute("data-lazy-l10n-id");
    }
    documento.l10n?.translateFragment(menu);
  });

  const cerrarTodos = () => abiertos(documento).reverse().forEach((p) => p.hidePopup());

  // Clic fuera: cierra los menús; si es sobre el ancla del que está abierto, el clic no vuelve a abrirlo.
  documento.addEventListener(
    "mousedown",
    (evento) => {
      const lista = abiertos(documento);
      if (!lista.length || lista.some((p) => p.contains(evento.target))) {
        return;
      }
      suprimirClic = lista.some((p) => p.anchorNode?.contains?.(evento.target)) ? evento.target : null;
      cerrarTodos();
    },
    true
  );
  documento.addEventListener(
    "click",
    (evento) => {
      if (suprimirClic) {
        const quedaEnAncla = suprimirClic.contains(evento.target) || evento.target.contains?.(suprimirClic);
        suprimirClic = null;
        if (quedaEnAncla) {
          evento.stopPropagation();
          evento.preventDefault();
        }
      }
    },
    true
  );
  ventana.addEventListener(
    "keydown",
    (evento) => {
      if (evento.key === "Escape" && abiertos(documento).length) {
        abiertos(documento).at(-1).hidePopup();
        evento.preventDefault();
        evento.stopPropagation();
      }
    },
    true
  );
  ventana.addEventListener("blur", cerrarTodos);

  // Menú contextual: un elemento con `context="id"` abre ese menú en el puntero.
  documento.addEventListener("contextmenu", (evento) => {
    const el = evento.target.closest?.("[context]");
    const id = el?.getAttribute("context");
    if (!id || id === "_child" || id === "_none") {
      return;
    }
    const menu = id === "_child" ? el.querySelector(ES_POPUP) : documento.getElementById(id);
    if (menu?.openPopup) {
      evento.preventDefault();
      cerrarTodos();
      menu.openPopup(null, "", evento.clientX, evento.clientY, true, false, evento);
    }
  });

  // Botones que abren un menú: `type="menu"` con un <menupopup> hijo, o `popup="id"`.
  documento.addEventListener("click", (evento) => {
    if (evento.defaultPrevented || evento.button !== 0) {
      return;
    }
    const boton = evento.target.closest?.("toolbarbutton[type='menu'], toolbarbutton[popup]");
    if (!boton) {
      return;
    }
    const id = boton.getAttribute("popup");
    const menu = id ? documento.getElementById(id) : boton.querySelector(ES_POPUP);
    if (menu?.openPopup && menu.state !== "open") {
      menu.openPopup(boton, "after_start", 0, 0, false, false, evento);
    }
  });

  // Submenús: un <menu> abre su <menupopup> al pasar el puntero o al hacer clic, a su derecha.
  const abrirSubmenu = (menu) => {
    const submenu = menu.querySelector(":scope > menupopup");
    if (submenu && submenu.state !== "open" && !menu.hasAttribute("disabled")) {
      submenu.openPopup(menu, "end_before", 0, 0, false, false, null);
    }
  };
  documento.addEventListener("mouseover", (evento) => {
    const item = evento.target.closest?.("menu, menuitem");
    if (!item || !item.parentElement?.matches?.("menupopup")) {
      return;
    }
    // Al pasar a otro elemento del mismo menú, se cierran los submenús de sus hermanos.
    for (const hermano of item.parentElement.children) {
      if (hermano !== item && hermano.localName === "menu") {
        hermano.querySelector(":scope > menupopup")?.hidePopup();
      }
    }
    if (item.localName === "menu") {
      abrirSubmenu(item);
    }
  });
  documento.addEventListener("click", (evento) => {
    const item = evento.target.closest?.("menu, menuitem");
    if (!item || evento.button !== 0 || !item.closest(ES_POPUP)) {
      return;
    }
    if (item.localName === "menu") {
      abrirSubmenu(item);
    } else if (item.getAttribute("closemenu") !== "none" && !item.hasAttribute("disabled")) {
      // El comando ya se ejecutó (xul.js); después se cierran todos los menús abiertos.
      setTimeout(cerrarTodos, 0);
    }
  });

  // La barra se expande y se contrae sin pasar por openPopup/hidePopup: se vigila su atributo y su tamaño.
  const barra = documento.getElementById("urlbar");
  if (barra) {
    new MutationObserver(avisarCubiertos).observe(barra, { attributes: true, attributeFilter: ["breakout-extend"] });
    new ResizeObserver(avisarCubiertos).observe(barra);
  }

  ventana.__rustronPopups = { colocar, cerrarTodos, avisarCubiertos };
  return ventana.__rustronPopups;
}
