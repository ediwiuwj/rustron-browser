// <arrowscrollbox> sin shadow DOM. El de toolkit lo construye con attachShadow, que WebKit no
// permite en elementos XUL, así que aquí el propio elemento es la caja desplazable (`scrollbox`
// devuelve `this`) y no hay botones de flecha: la barra de pestañas vertical de Zen no los usa.
// Cubre lo que leen tabs.mjs y Zen: scrollbox, scrollByPixels, scrollClientRect, scrollPosition,
// scrollIncrement, overflowing, ensureElementIsVisible, _getScrollableElements, _canScrollToElement
// y los eventos overflow/underflow.

export function definirArrowScrollbox(ventana) {
  class MozArrowScrollbox extends ventana.MozXULElement {
    #observadores = [];
    #desbordado = false;
    smoothScroll = true;

    get scrollbox() {
      return this;
    }

    get vertical() {
      return this.getAttribute("orient") === "vertical";
    }

    get scrollClientRect() {
      return this.getBoundingClientRect();
    }

    get scrollPosition() {
      return this.vertical ? this.scrollTop : this.scrollLeft;
    }

    get lineScrollAmount() {
      return 50;
    }

    get scrollIncrement() {
      return this.lineScrollAmount;
    }

    get overflowing() {
      return this.vertical ? this.scrollHeight > this.clientHeight : this.scrollWidth > this.clientWidth;
    }

    // Los botones de flecha no existen; se devuelven vacíos para que el código que los consulta no falle.
    get _scrollButtonUp() {
      return null;
    }
    get _scrollButtonDown() {
      return null;
    }

    _getScrollableElements() {
      return [...this.children].filter((e) => this._canScrollToElement(e));
    }

    _canScrollToElement(elemento) {
      return !elemento.hidden;
    }

    scrollByPixels(pixeles, instantaneo = false) {
      const comportamiento = instantaneo || !this.smoothScroll ? "instant" : "smooth";
      this.scrollBy(this.vertical ? { top: pixeles, behavior: comportamiento } : { left: pixeles, behavior: comportamiento });
    }

    ensureElementIsVisible(elemento, instantaneo = false) {
      elemento.scrollIntoView({ block: "nearest", inline: "nearest", behavior: instantaneo || !this.smoothScroll ? "instant" : "smooth" });
    }

    #comprobar() {
      const desbordado = this.overflowing;
      if (desbordado !== this.#desbordado) {
        this.#desbordado = desbordado;
        this.dispatchEvent(new Event(desbordado ? "overflow" : "underflow"));
      }
    }

    connectedCallback() {
      this.#observadores.push(new ventana.ResizeObserver(() => this.#comprobar()));
      this.#observadores[0].observe(this);
      this.#observadores.push(new ventana.MutationObserver(() => this.#comprobar()));
      this.#observadores[1].observe(this, { childList: true });
    }

    disconnectedCallback() {
      this.#observadores.forEach((o) => o.disconnect());
      this.#observadores = [];
    }
  }
  ventana.customElements.define("arrowscrollbox", MozArrowScrollbox);
  return MozArrowScrollbox;
}
