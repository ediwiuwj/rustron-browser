// Intérprete de Fluent (los .ftl de Firefox y Zen).
//
// Firefox analiza Fluent con una biblioteca de Rust (fluent-rs) que aquí no existe, y no trae una
// versión en JS, así que este módulo implementa el formato: mensajes, atributos, términos, variables,
// referencias, selectores (con categorías de plural) y las funciones NUMBER, DATETIME y PLATFORM.
// No implementa: comentarios asociados a mensajes (se ignoran), aislamiento bidi (Firefox lo desactiva
// por defecto) ni funciones definidas por el usuario.

const MARCA = ""; // sustituye a cada {placeable} mientras se quita la sangría del texto

export class ErrorFluent extends Error {}

// ---------------------------------------------------------------------------------------------
// Análisis

class Lector {
  constructor(texto) {
    this.s = texto;
    this.i = 0;
  }
  get fin() {
    return this.i >= this.s.length;
  }
  espacios() {
    while (!this.fin && /\s/.test(this.s[this.i])) {
      this.i++;
    }
  }
  empieza(cadena) {
    return this.s.startsWith(cadena, this.i);
  }
  esperar(cadena) {
    if (!this.empieza(cadena)) {
      throw new ErrorFluent(`se esperaba "${cadena}" en ${this.i}: ${this.s.slice(this.i, this.i + 20)}`);
    }
    this.i += cadena.length;
  }
  identificador() {
    const m = /^[a-zA-Z][a-zA-Z0-9_-]*/.exec(this.s.slice(this.i));
    if (!m) {
      throw new ErrorFluent(`identificador esperado en ${this.i}`);
    }
    this.i += m[0].length;
    return m[0];
  }
}

function cadenaLiteral(l) {
  l.esperar('"');
  let valor = "";
  while (!l.fin && l.s[l.i] !== '"') {
    if (l.s[l.i] === "\\") {
      const sig = l.s[l.i + 1];
      if (sig === "u") {
        valor += String.fromCharCode(parseInt(l.s.slice(l.i + 2, l.i + 6), 16));
        l.i += 6;
      } else if (sig === "U") {
        valor += String.fromCodePoint(parseInt(l.s.slice(l.i + 2, l.i + 8), 16));
        l.i += 8;
      } else {
        valor += sig;
        l.i += 2;
      }
    } else {
      valor += l.s[l.i++];
    }
  }
  l.esperar('"');
  return { tipo: "lit", valor };
}

function argumentos(l) {
  const pos = [];
  const nombrados = {};
  l.esperar("(");
  for (;;) {
    l.espacios();
    if (l.empieza(")")) {
      l.i++;
      return { pos, nombrados };
    }
    const m = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*:/.exec(l.s.slice(l.i));
    if (m) {
      l.i += m[0].length;
      l.espacios();
      nombrados[m[1]] = expresionEnLinea(l);
    } else {
      pos.push(expresionEnLinea(l));
    }
    l.espacios();
    if (l.empieza(",")) {
      l.i++;
    }
  }
}

function atributoOpcional(l) {
  const m = /^\.([a-zA-Z][a-zA-Z0-9_-]*)/.exec(l.s.slice(l.i));
  if (!m) {
    return null;
  }
  l.i += m[0].length;
  return m[1];
}

function expresionEnLinea(l) {
  const c = l.s[l.i];
  if (c === '"') {
    return cadenaLiteral(l);
  }
  if (c === "{") {
    l.i++;
    return placeable(l);
  }
  const num = /^-?[0-9]+(\.[0-9]+)?/.exec(l.s.slice(l.i));
  if (num) {
    l.i += num[0].length;
    return { tipo: "num", valor: parseFloat(num[0]), texto: num[0] };
  }
  if (c === "$") {
    l.i++;
    return { tipo: "var", nombre: l.identificador() };
  }
  if (c === "-") {
    l.i++;
    const id = "-" + l.identificador();
    const attr = atributoOpcional(l);
    const args = l.empieza("(") ? argumentos(l) : null;
    return { tipo: "term", id, attr, args };
  }
  const id = l.identificador();
  if (l.empieza("(")) {
    return { tipo: "fn", nombre: id, ...argumentos(l) };
  }
  return { tipo: "msg", id, attr: atributoOpcional(l) };
}

// Lee desde después de `{` hasta el `}` que lo cierra.
function placeable(l) {
  l.espacios();
  const expr = expresionEnLinea(l);
  l.espacios();
  if (l.empieza("->")) {
    l.i += 2;
    const variantes = [];
    for (;;) {
      l.espacios();
      if (l.empieza("}")) {
        l.i++;
        break;
      }
      const porDefecto = l.empieza("*");
      if (porDefecto) {
        l.i++;
      }
      l.esperar("[");
      const fin = l.s.indexOf("]", l.i);
      const clave = l.s.slice(l.i, fin).trim();
      l.i = fin + 1;
      const hasta = finDeVariante(l.s, l.i);
      variantes.push({ clave, porDefecto, patron: patronDeTexto(l.s.slice(l.i, hasta)) });
      l.i = hasta;
    }
    return { tipo: "sel", selector: expr, variantes };
  }
  l.esperar("}");
  return expr;
}

// Índice donde acaba el texto de una variante: la siguiente línea que empieza por `[`, `*[` o `}`.
function finDeVariante(s, desde) {
  let profundidad = 0;
  for (let i = desde; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      i = s.indexOf('"', i + 1);
      while (i > 0 && s[i - 1] === "\\") {
        i = s.indexOf('"', i + 1);
      }
    } else if (c === "{") {
      profundidad++;
    } else if (c === "}") {
      if (profundidad === 0) {
        return i;
      }
      profundidad--;
    } else if (c === "\n" && profundidad === 0) {
      const resto = /^\n[ \t\n]*(\*?\[|\})/.exec(s.slice(i));
      if (resto) {
        return i;
      }
    }
  }
  return s.length;
}

// Texto de un patrón -> elementos (cadenas y expresiones), sin la sangría común.
function patronDeTexto(texto) {
  const expresiones = [];
  let plano = "";
  const l = new Lector(texto);
  while (!l.fin) {
    if (l.s[l.i] === "{") {
      l.i++;
      expresiones.push(placeable(l));
      plano += MARCA;
    } else {
      plano += l.s[l.i++];
    }
  }
  const lineas = plano.split("\n");
  const comun = Math.min(
    Infinity,
    ...lineas.slice(1).filter((x) => /\S/.test(x)).map((x) => /^ */.exec(x)[0].length)
  );
  const cuerpo = lineas
    .map((x, n) => (n === 0 ? x.replace(/^ +/, "") : /\S/.test(x) ? x.slice(Number.isFinite(comun) ? comun : 0) : ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/[ \n]+$/, "");
  const patron = [];
  let n = 0;
  for (const trozo of cuerpo.split(MARCA)) {
    if (trozo) {
      patron.push(trozo);
    }
    if (n < expresiones.length) {
      patron.push(expresiones[n++]);
    }
  }
  return patron;
}

// Parte el cuerpo de una entrada en su valor y sus atributos (líneas `.nombre = ...` fuera de llaves).
function segmentos(cuerpo) {
  const partes = [{ nombre: null, texto: "" }];
  let profundidad = 0;
  let iniciaLinea = true;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (iniciaLinea && profundidad === 0) {
      const m = /^[ ]*\.([a-zA-Z][a-zA-Z0-9_-]*)[ ]*=/.exec(cuerpo.slice(i));
      if (m) {
        partes.push({ nombre: m[1], texto: "" });
        i += m[0].length - 1;
        iniciaLinea = false;
        continue;
      }
    }
    partes[partes.length - 1].texto += c;
    if (c === '"' && profundidad > 0) {
      const fin = cuerpo.indexOf('"', i + 1);
      partes[partes.length - 1].texto += cuerpo.slice(i + 1, fin + 1);
      i = fin;
    } else if (c === "{") {
      profundidad++;
    } else if (c === "}") {
      profundidad--;
    }
    iniciaLinea = c === "\n";
  }
  return partes;
}

// Texto de un .ftl -> entradas { id, valor, atributos }.
export function analizar(texto) {
  const entradas = [];
  let actual = null;
  for (const linea of texto.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^[a-zA-Z-]/.test(linea)) {
      const m = /^(-?[a-zA-Z][a-zA-Z0-9_-]*)[ ]*=(.*)$/.exec(linea);
      actual = m ? { id: m[1], lineas: [m[2]] } : null;
      if (actual) {
        entradas.push(actual);
      }
    } else if (actual && (linea.startsWith(" ") || linea.startsWith("}") || linea.trim() === "")) {
      // (Firefox escribe a menudo el `}` que cierra un selector en la columna 0.)
      actual.lineas.push(linea);
    } else {
      actual = null; // comentario (#), o basura
    }
  }
  const resultado = [];
  for (const { id, lineas } of entradas) {
    try {
      const [valor, ...atributos] = segmentos(lineas.join("\n"));
      const patron = patronDeTexto(valor.texto);
      resultado.push({
        id,
        valor: patron.length ? patron : null,
        atributos: Object.fromEntries(atributos.map((a) => [a.nombre, patronDeTexto(a.texto)])),
      });
    } catch (e) {
      resultado.push({ id, error: e.message });
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------------------------
// Formato

export class Paquete {
  constructor(locales) {
    this.locales = Array.isArray(locales) ? locales : [locales];
    this.mensajes = new Map();
    this.errores = [];
  }

  agregar(texto) {
    for (const entrada of analizar(texto)) {
      if (entrada.error) {
        this.errores.push(`${entrada.id}: ${entrada.error}`);
      } else if (!this.mensajes.has(entrada.id)) {
        this.mensajes.set(entrada.id, entrada); // el primer recurso que lo define gana
      }
    }
  }

  tiene(id) {
    return this.mensajes.has(id);
  }

  // { valor: string|null, atributos: { nombre: string } } o null si el mensaje no existe.
  formatearMensaje(id, args = {}) {
    const m = this.mensajes.get(id);
    if (!m) {
      return null;
    }
    const errores = [];
    return {
      valor: m.valor ? this.#patron(m.valor, args, errores, 0) : null,
      atributos: Object.fromEntries(
        Object.entries(m.atributos).map(([nombre, p]) => [nombre, this.#patron(p, args, errores, 0)])
      ),
      errores,
    };
  }

  #patron(patron, args, errores, profundidad) {
    if (profundidad > 20) {
      errores.push("referencias demasiado anidadas");
      return "";
    }
    return patron
      .map((el) => (typeof el === "string" ? el : textoDe(this.#evaluar(el, args, errores, profundidad + 1))))
      .join("");
  }

  #evaluar(el, args, errores, profundidad) {
    switch (el.tipo) {
      case "lit":
        return el.valor;
      case "num":
        return { numero: el.valor, texto: el.texto };
      case "var": {
        if (!(el.nombre in args)) {
          errores.push(`falta la variable $${el.nombre}`);
          return `{$${el.nombre}}`;
        }
        const v = args[el.nombre];
        return typeof v === "number" ? { numero: v } : v;
      }
      case "msg":
      case "term": {
        const m = this.mensajes.get(el.id);
        if (!m) {
          errores.push(`falta ${el.id}`);
          return `{${el.id}}`;
        }
        // Los términos reciben sus propios argumentos; los mensajes ven los de quien los usa.
        let propios = args;
        if (el.tipo === "term") {
          propios = {};
          for (const [k, v] of Object.entries(el.args?.nombrados ?? {})) {
            propios[k] = this.#evaluar(v, args, errores, profundidad);
          }
        }
        const patron = el.attr ? m.atributos[el.attr] : m.valor;
        if (!patron) {
          errores.push(`falta ${el.id}${el.attr ? "." + el.attr : ""}`);
          return `{${el.id}}`;
        }
        return this.#patron(patron, propios, errores, profundidad);
      }
      case "fn":
        return this.#funcion(el, args, errores, profundidad);
      case "sel": {
        const valor = this.#evaluar(el.selector, args, errores, profundidad);
        const numero = typeof valor === "object" && valor && "numero" in valor ? valor.numero : null;
        const cadena = textoDe(valor);
        const categoria = numero === null ? null : new Intl.PluralRules(this.locales).select(numero);
        const elegida =
          el.variantes.find((v) => v.clave === cadena || (numero !== null && (v.clave === String(numero) || v.clave === categoria))) ??
          el.variantes.find((v) => v.porDefecto) ??
          el.variantes[0];
        return this.#patron(elegida.patron, args, errores, profundidad);
      }
      default:
        errores.push(`expresión desconocida ${el.tipo}`);
        return "";
    }
  }

  #funcion(el, args, errores, profundidad) {
    const pos = el.pos.map((p) => this.#evaluar(p, args, errores, profundidad));
    const opciones = Object.fromEntries(
      Object.entries(el.nombrados).map(([k, v]) => {
        const valor = this.#evaluar(v, args, errores, profundidad);
        return [k, typeof valor === "object" && valor && "numero" in valor ? valor.numero : valor];
      })
    );
    switch (el.nombre) {
      case "NUMBER": {
        const origen = pos[0];
        const numero = typeof origen === "object" && origen && "numero" in origen ? origen.numero : Number(origen);
        return { numero, texto: new Intl.NumberFormat(this.locales, opciones).format(numero) };
      }
      case "DATETIME": {
        const fecha = pos[0] instanceof Date ? pos[0] : new Date(typeof pos[0] === "object" ? pos[0].numero : pos[0]);
        if (Number.isNaN(fecha.getTime())) {
          errores.push("DATETIME sin fecha válida");
          return "";
        }
        return new Intl.DateTimeFormat(this.locales, opciones).format(fecha);
      }
      case "PLATFORM":
        return "linux";
      default:
        errores.push(`función desconocida ${el.nombre}`);
        return `${el.nombre}()`;
    }
  }
}

function textoDe(valor) {
  if (valor === null || valor === undefined) {
    return "";
  }
  if (typeof valor === "object" && "numero" in valor) {
    return valor.texto ?? String(valor.numero);
  }
  if (valor instanceof Date) {
    return valor.toISOString();
  }
  return String(valor);
}
