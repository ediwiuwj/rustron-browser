// MozXULElement y MozTabbrowserTabGroup: la base de los custom elements de Zen.
// Zen hace `class X extends MozXULElement` y `customElements.define(...)`, así que deben
// descender de XULElement (que hereda de HTMLElement). parseXULToFragment crea elementos XUL mejorados (xul.js).

import { mejorar } from "./xul.js";

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

export function crearMozXULElement(ventana) {
  const analizador = new ventana.DOMParser();

  class MozXULElement extends ventana.XULElement {
    static parseXULToFragment(xul) {
      const documento = analizador.parseFromString(
        `<root xmlns="${XUL_NS}" xmlns:html="http://www.w3.org/1999/xhtml">${xul}</root>`,
        "application/xml"
      );
      if (documento.querySelector("parsererror")) {
        throw new Error("parseXULToFragment: XUL mal formado");
      }
      const fragmento = ventana.document.createDocumentFragment();
      for (const hijo of [...documento.documentElement.childNodes]) {
        const nodo = ventana.document.importNode(hijo, true);
        fragmento.append(nodo);
        if (nodo.nodeType === 1) {
          mejorar(nodo);
          nodo.querySelectorAll("*").forEach(mejorar);
        }
      }
      return fragmento;
    }

    // Las cadenas FTL se aplican con localización real más adelante; aquí no hacen nada.
    static insertFTLIfNeeded() {}
  }

  class MozTabbrowserTabGroup extends MozXULElement {}

  return { MozXULElement, MozTabbrowserTabGroup };
}
