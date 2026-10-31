// Implementación de Services.prefs para la capa de compatibilidad Zen sobre WebKit.
// Imita las reglas de Firefox: tipos estrictos, ramas con prefijo y observadores.

export const PREF_INVALID = 0;
export const PREF_STRING = 32;
export const PREF_INT = 64;
export const PREF_BOOL = 128;

const TOPIC = "nsPref:changed";

function tipoDe(valor) {
  switch (typeof valor) {
    case "boolean":
      return PREF_BOOL;
    case "number":
      return PREF_INT;
    case "string":
      return PREF_STRING;
    default:
      return PREF_INVALID;
  }
}

const NOMBRE_TIPO = { [PREF_BOOL]: "bool", [PREF_INT]: "int", [PREF_STRING]: "string" };

class Almacen {
  defaults = new Map();
  usuario = new Map();
  observadores = [];

  valor(nombre) {
    return this.usuario.has(nombre) ? this.usuario.get(nombre) : this.defaults.get(nombre);
  }
}

export class Rama {
  #almacen;
  #prefijo;

  constructor(almacen, prefijo = "") {
    this.#almacen = almacen;
    this.#prefijo = prefijo;
    // Los métodos de XPCOM no dependen de `this`: el código de Firefox los extrae y los llama sueltos
    // (p. ej. `const leer = Services.prefs[metodo]; leer(nombre)`).
    for (const nombre of Object.getOwnPropertyNames(Rama.prototype)) {
      const d = Object.getOwnPropertyDescriptor(Rama.prototype, nombre);
      if (nombre !== "constructor" && typeof d.value === "function") {
        this[nombre] = d.value.bind(this);
      }
    }
  }

  get root() {
    return this.#prefijo;
  }

  #completo(nombre) {
    return this.#prefijo + nombre;
  }

  getBranch(prefijo) {
    return new Rama(this.#almacen, this.#completo(prefijo));
  }

  getPrefType(nombre) {
    return tipoDe(this.#almacen.valor(this.#completo(nombre)));
  }

  #leer(nombre, tipo, argumentos) {
    const completo = this.#completo(nombre);
    const valor = this.#almacen.valor(completo);
    if (valor === undefined) {
      if (argumentos.length > 1) {
        return argumentos[1];
      }
      throw new Error(`NS_ERROR_UNEXPECTED: la preferencia '${completo}' no existe`);
    }
    if (tipoDe(valor) !== tipo) {
      throw new Error(
        `NS_ERROR_UNEXPECTED: '${completo}' es ${NOMBRE_TIPO[tipoDe(valor)]}, no ${NOMBRE_TIPO[tipo]}`
      );
    }
    return valor;
  }

  getBoolPref(...args) {
    return this.#leer(args[0], PREF_BOOL, args);
  }

  getIntPref(...args) {
    return this.#leer(args[0], PREF_INT, args);
  }

  getStringPref(...args) {
    return this.#leer(args[0], PREF_STRING, args);
  }

  getCharPref(...args) {
    return this.#leer(args[0], PREF_STRING, args);
  }

  #escribir(nombre, tipo, valor) {
    const completo = this.#completo(nombre);
    if (tipoDe(valor) !== tipo || (tipo === PREF_INT && !Number.isInteger(valor))) {
      throw new Error(`NS_ERROR_ILLEGAL_VALUE: valor no válido para '${completo}'`);
    }
    const actual = this.#almacen.valor(completo);
    if (actual !== undefined && tipoDe(actual) !== tipo) {
      throw new Error(
        `NS_ERROR_UNEXPECTED: '${completo}' es ${NOMBRE_TIPO[tipoDe(actual)]}, no ${NOMBRE_TIPO[tipo]}`
      );
    }
    if (this.#almacen.defaults.get(completo) === valor) {
      this.#almacen.usuario.delete(completo);
    } else {
      this.#almacen.usuario.set(completo, valor);
    }
    if (actual !== valor) {
      this.#notificar(completo);
    }
  }

  setBoolPref(nombre, valor) {
    this.#escribir(nombre, PREF_BOOL, valor);
  }

  setIntPref(nombre, valor) {
    this.#escribir(nombre, PREF_INT, valor);
  }

  setStringPref(nombre, valor) {
    this.#escribir(nombre, PREF_STRING, valor);
  }

  setCharPref(nombre, valor) {
    this.#escribir(nombre, PREF_STRING, valor);
  }

  prefHasUserValue(nombre) {
    return this.#almacen.usuario.has(this.#completo(nombre));
  }

  prefHasDefaultValue(nombre) {
    return this.#almacen.defaults.has(this.#completo(nombre));
  }

  clearUserPref(nombre) {
    const completo = this.#completo(nombre);
    if (this.#almacen.usuario.delete(completo)) {
      this.#notificar(completo);
    }
  }

  prefIsLocked() {
    return false;
  }

  lockPref() {}

  unlockPref() {}

  getChildList(prefijo = "") {
    const base = this.#completo(prefijo);
    const nombres = new Set([...this.#almacen.defaults.keys(), ...this.#almacen.usuario.keys()]);
    return [...nombres]
      .filter((n) => n.startsWith(base))
      .map((n) => n.slice(this.#prefijo.length))
      .sort();
  }

  addObserver(dominio, observador) {
    this.#almacen.observadores.push({ prefijo: this.#completo(dominio), observador, rama: this });
  }

  removeObserver(dominio, observador) {
    const prefijo = this.#completo(dominio);
    const indice = this.#almacen.observadores.findIndex(
      (o) => o.prefijo === prefijo && o.observador === observador
    );
    if (indice >= 0) {
      this.#almacen.observadores.splice(indice, 1);
    }
  }

  #notificar(completo) {
    for (const { prefijo, observador, rama } of [...this.#almacen.observadores]) {
      if (!completo.startsWith(prefijo)) {
        continue;
      }
      const relativo = completo.slice(rama.root.length);
      if (typeof observador === "function") {
        observador(rama, TOPIC, relativo);
      } else {
        observador.observe(rama, TOPIC, relativo);
      }
    }
  }

  // Extensiones propias de Rustron (no existen en Firefox).
  cargarDefaults(objeto) {
    for (const [nombre, valor] of Object.entries(objeto)) {
      if (tipoDe(valor) !== PREF_INVALID) {
        this.#almacen.defaults.set(nombre, valor);
      }
    }
  }

  cargarUsuario(objeto) {
    for (const [nombre, valor] of Object.entries(objeto)) {
      if (tipoDe(valor) !== PREF_INVALID) {
        this.#almacen.usuario.set(nombre, valor);
      }
    }
  }

  valoresDeUsuario() {
    return Object.fromEntries(this.#almacen.usuario);
  }
}

export function crearPrefs(defaults = {}) {
  const rama = new Rama(new Almacen());
  rama.cargarDefaults(defaults);
  return rama;
}
