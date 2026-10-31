// nsIURI mínimo para Services.io.newURI, apoyado en la clase URL del navegador.
// Solo las propiedades que usa Zen. Los errores imitan los códigos de Firefox.

function error(codigo, mensaje) {
  return Object.assign(new Error(`${codigo}: ${mensaje}`), { result: codigo });
}

class URI {
  #url;

  constructor(url) {
    this.#url = url;
  }

  get spec() {
    return this.#url.href;
  }

  get scheme() {
    return this.#url.protocol.slice(0, -1);
  }

  // Como en Firefox, es un error pedir el host de URIs que no lo tienen (about:, data:).
  get host() {
    if (!this.#url.hostname) {
      throw error("NS_ERROR_FAILURE", `${this.scheme}: no tiene host`);
    }
    return this.#url.hostname;
  }

  get asciiHost() {
    return this.host;
  }

  get port() {
    return this.#url.port === "" ? -1 : Number(this.#url.port);
  }

  get hostPort() {
    return this.#url.host;
  }

  get prePath() {
    return this.#url.hostname ? `${this.#url.protocol}//${this.#url.host}` : this.#url.protocol;
  }

  get filePath() {
    return this.#url.pathname;
  }

  get query() {
    return this.#url.search.slice(1);
  }

  get ref() {
    return this.#url.hash.slice(1);
  }

  get pathQueryRef() {
    return this.#url.pathname + this.#url.search + this.#url.hash;
  }

  schemeIs(esquema) {
    return this.scheme === esquema.toLowerCase();
  }

  equals(otra) {
    return this.spec === otra.spec;
  }

  resolve(relativa) {
    return new URL(relativa, this.#url).href;
  }

  clone() {
    return new URI(new URL(this.#url));
  }

  toString() {
    return this.spec;
  }
}

export function nuevaURI(spec, base) {
  const baseUrl = base == null ? undefined : base.spec ?? String(base);
  try {
    return new URI(new URL(String(spec), baseUrl));
  } catch {
    throw error("NS_ERROR_MALFORMED_URI", `URI inválida: ${spec}`);
  }
}
