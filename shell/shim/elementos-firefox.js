// Complementos de MozXULElement (que define el customElements.js real de toolkit).
// parseXULToFragment se sustituye: el original usa DOMParser.parseFromSafeString (solo Firefox) y
// devuelve nodos de otro documento; aquí se importan al documento y se mejoran al instante.
// MozTabbrowserTabGroup lo define tabgroup.mjs; mientras no se cargue hay una base vacía.

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export function instalarComplementosXUL(ventana) {
  const analizador = new ventana.DOMParser();

  ventana.MozXULElement.parseXULToFragment = (xul) => {
    const documento = analizador.parseFromString(
      `<root xmlns="${XUL_NS}" xmlns:html="${XHTML_NS}">${xul}</root>`,
      "application/xml"
    );
    if (documento.querySelector("parsererror")) {
      throw new Error("parseXULToFragment: XUL mal formado");
    }
    const fragmento = ventana.document.createDocumentFragment();
    // importNode ya mejora el árbol (xul.js); los espacios en blanco se descartan como en Firefox.
    for (const hijo of [...documento.documentElement.childNodes]) {
      if (hijo.nodeType === 1) {
        fragmento.append(ventana.document.importNode(hijo, true));
      }
    }
    return fragmento;
  };

  // Las cadenas FTL se aplicarán con localización real más adelante.
  ventana.MozXULElement.insertFTLIfNeeded = () => {};

  // Bases de los popups. Las reales (menupopup.js, panel.js, autocomplete-popup.js de toolkit) construyen un
  // shadow DOM con flechas de desplazamiento, que WebKit no admite en elementos XUL; aquí son clases sin
  // shadow sobre XULPopupElement (xul.js ya da abrir/cerrar, estado y eventos). Las clases de Firefox y de Zen
  // que extienden estas (places-menupopup.js, autocomplete-popup.js de browser...) funcionan igual.
  const Popup = ventana.MozElements.MozElementMixin(ventana.XULPopupElement);
  ventana.MozElements.MozMenuPopup ??= class MozMenuPopup extends Popup {};
  ventana.MozElements.MozPanel ??= class MozPanel extends Popup {};
  ventana.MozElements.MozAutocompleteRichlistboxPopup ??= class MozAutocompleteRichlistboxPopup extends Popup {};

  ventana.MozTabbrowserTabGroup ??= class MozTabbrowserTabGroup extends ventana.MozXULElement {};
}
