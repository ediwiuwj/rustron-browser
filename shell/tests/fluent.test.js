import { test } from "node:test";
import assert from "node:assert/strict";
import { Paquete, analizar } from "../shim/fluent.js";

const paquete = (texto, loc = "en-US") => {
  const p = new Paquete(loc);
  p.agregar(texto);
  return p;
};

test("mensaje simple, comentarios y atributos", () => {
  const p = paquete(`
# comentario
hola = Hola mundo
boton = Guardar
    .title = Guardar el archivo
    .accesskey = G
`);
  assert.equal(p.formatearMensaje("hola").valor, "Hola mundo");
  const b = p.formatearMensaje("boton");
  assert.equal(b.valor, "Guardar");
  assert.deepEqual(b.atributos, { title: "Guardar el archivo", accesskey: "G" });
  assert.equal(p.formatearMensaje("nada"), null);
});

test("mensaje solo con atributos no tiene valor", () => {
  const p = paquete(`btn =\n    .label = Nuevo\n    .tooltiptext = Nueva pestaña\n`);
  const m = p.formatearMensaje("btn");
  assert.equal(m.valor, null);
  assert.equal(m.atributos.label, "Nuevo");
});

test("variables, términos y referencias a mensajes", () => {
  const p = paquete(`
-brand = Zen
saludo = Hola, { $nombre }. Bienvenido a { -brand }.
otro = { saludo } Adiós.
`);
  assert.equal(p.formatearMensaje("saludo", { nombre: "Ana" }).valor, "Hola, Ana. Bienvenido a Zen.");
  assert.equal(p.formatearMensaje("otro", { nombre: "Ana" }).valor, "Hola, Ana. Bienvenido a Zen. Adiós.");
  assert.match(p.formatearMensaje("saludo").errores[0], /nombre/);
});

test("términos con atributos y argumentos", () => {
  const p = paquete(`
-marca = { $caso ->
    [gen] de Zen
   *[nom] Zen
    }
a = { -marca }
b = { -marca(caso: "gen") }
`);
  assert.equal(p.formatearMensaje("a").valor, "Zen");
  assert.equal(p.formatearMensaje("b").valor, "de Zen");
});

test("selectores por plural y por valor", () => {
  const p = paquete(`
pestanas = { $n ->
    [one] Una pestaña
   *[other] { $n } pestañas
    }
sexo = { $s ->
    [m] él
    [f] ella
   *[x] elle
    }
`);
  assert.equal(p.formatearMensaje("pestanas", { n: 1 }).valor, "Una pestaña");
  assert.equal(p.formatearMensaje("pestanas", { n: 5 }).valor, "5 pestañas");
  assert.equal(p.formatearMensaje("sexo", { s: "f" }).valor, "ella");
  assert.equal(p.formatearMensaje("sexo", { s: "zz" }).valor, "elle");
});

test("texto de varias líneas: sangría común, líneas en blanco y literales", () => {
  const p = paquete(`
largo =
    Primera línea
      con sangría
    tercera

    después de un hueco
llave = Una { "{" } llave y { "cadena" }
pegado = x
`);
  assert.equal(p.formatearMensaje("largo").valor, "Primera línea\n  con sangría\ntercera\n\ndespués de un hueco");
  assert.equal(p.formatearMensaje("llave").valor, "Una { llave y cadena");
});

test("NUMBER y el primer recurso que define un mensaje gana", () => {
  const p = paquete(`n = { NUMBER($x, minimumFractionDigits: 2) } km\n`);
  assert.equal(p.formatearMensaje("n", { x: 3 }).valor, "3.00 km");
  p.agregar("n = otro\nm = nuevo\n");
  assert.equal(p.formatearMensaje("n", { x: 3 }).valor, "3.00 km");
  assert.equal(p.formatearMensaje("m").valor, "nuevo");
});

test("entradas rotas se anotan y no impiden las demás", () => {
  const e = analizar("roto = { $x\nbueno = ok\n");
  assert.ok(e.find((x) => x.id === "bueno"));
});
