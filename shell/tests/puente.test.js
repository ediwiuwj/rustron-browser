import test from "node:test";
import assert from "node:assert/strict";

import { Puente, almacenamientoRemoto, instalarEnVentana } from "../shim/puente.js";
import { JSONFile, usarAlmacenamiento } from "../shim/modulos/JSONFile.sys.mjs";

function crear() {
  const enviados = [];
  const puente = new Puente((texto) => enviados.push(JSON.parse(texto)));
  return { puente, enviados };
}

const pestana = (id, extra = {}) => ({
  id, titulo: "", uri: "about:blank", cargando: false, fijada: false, espacio: 1, ...extra,
});

const instantanea = {
  tipo: "instantanea",
  estado: {
    espacios: [{ id: 1, nombre: "Space", pestanas: [1] }],
    pestanas: [pestana(1)],
    espacioActivo: 1,
    pestanaActiva: 1,
    barraVisible: true,
    compacto: false,
    barraUrlAbierta: false,
  },
};

test("conectar y accion envían los mensajes del protocolo", () => {
  const { puente, enviados } = crear();
  puente.conectar();
  puente.accion("navegar", { pestana: 3, texto: "rust-lang.org" });
  puente.accion("alternar-barra");
  assert.deepEqual(enviados, [
    { tipo: "listo" },
    { tipo: "accion", accion: { nombre: "navegar", pestana: 3, texto: "rust-lang.org" } },
    { tipo: "accion", accion: { nombre: "alternar-barra" } },
  ]);
});

test("la instantánea llena el espejo", () => {
  const { puente } = crear();
  assert.equal(puente.listo, false);
  puente.recibir(JSON.stringify(instantanea));
  assert.equal(puente.listo, true);
  assert.equal(puente.pestanas.get(1).uri, "about:blank");
  assert.equal(puente.espacioActivo, 1);
  assert.equal(puente.pestanaActiva, 1);
  assert.equal(puente.espacios[0].nombre, "Space");
});

test("los eventos mantienen el espejo al día", () => {
  const { puente } = crear();
  puente.recibir(JSON.stringify(instantanea));
  const rx = (m) => puente.recibir(JSON.stringify(m));

  rx({ tipo: "pestana-creada", pestana: pestana(2, { uri: "https://a.com" }) });
  rx({ tipo: "espacios", espacios: [{ id: 1, nombre: "Space", pestanas: [1, 2] }] });
  rx({ tipo: "pestana-activada", id: 2 });
  assert.equal(puente.pestanas.size, 2);
  assert.deepEqual(puente.espacios[0].pestanas, [1, 2]);
  assert.equal(puente.pestanaActiva, 2);

  rx({ tipo: "pestana-actualizada", pestana: pestana(2, { titulo: "A", cargando: true }) });
  assert.equal(puente.pestanas.get(2).titulo, "A");

  rx({ tipo: "pestana-cerrada", id: 2 });
  rx({ tipo: "pestana-activada", id: null });
  assert.equal(puente.pestanas.has(2), false);
  assert.equal(puente.pestanaActiva, null);

  rx({ tipo: "espacio-activado", id: 5 });
  rx({ tipo: "interfaz", barraVisible: false, compacto: true, barraUrlAbierta: false });
  assert.equal(puente.espacioActivo, 5);
  assert.deepEqual(puente.interfaz, { barraVisible: false, compacto: true, barraUrlAbierta: false });
});

test("on entrega los eventos después de actualizar el espejo y permite darse de baja", () => {
  const { puente } = crear();
  const vistos = [];
  const baja = puente.on("pestana-creada", (m) => vistos.push([m.pestana.id, puente.pestanas.has(m.pestana.id)]));
  puente.recibir(JSON.stringify({ tipo: "pestana-creada", pestana: pestana(7) }));
  baja();
  puente.recibir(JSON.stringify({ tipo: "pestana-creada", pestana: pestana(8) }));
  assert.deepEqual(vistos, [[7, true]]);
});

test("peticion se resuelve o rechaza según la respuesta de Rust", async () => {
  const { puente, enviados } = crear();
  const bien = puente.peticion("leer", { ruta: "a.json" });
  const mal = puente.peticion("escribir", { ruta: "../x", texto: "" });
  assert.deepEqual(enviados.map((m) => m.id), [1, 2]);
  puente.recibir(JSON.stringify({ tipo: "respuesta", id: 2, ok: false, error: "ruta fuera del perfil" }));
  puente.recibir(JSON.stringify({ tipo: "respuesta", id: 1, ok: true, valor: "{}" }));
  puente.recibir(JSON.stringify({ tipo: "respuesta", id: 99, ok: true, valor: null })); // se ignora
  assert.equal(await bien, "{}");
  await assert.rejects(mal, /ruta fuera del perfil/);
});

test("JSONFile guarda y carga a través del puente", async () => {
  const { puente, enviados } = crear();
  usarAlmacenamiento(almacenamientoRemoto(puente));
  const f = new JSONFile({ path: "sesion.json" });
  const carga = f.load();
  assert.equal(enviados[0].metodo, "leer");
  puente.recibir(JSON.stringify({ tipo: "respuesta", id: enviados[0].id, ok: true, valor: '{"n":1}' }));
  await carga;
  assert.equal(f.data.n, 1);

  f.data.n = 2;
  const guardado = f._save();
  assert.deepEqual(enviados[1].args, { ruta: "sesion.json", texto: '{"n":2}' });
  puente.recibir(JSON.stringify({ tipo: "respuesta", id: enviados[1].id, ok: true, valor: null }));
  await guardado;
});

test("instalarEnVentana conecta el manejador de WebKit y el receptor", () => {
  const enviados = [];
  const ventana = { webkit: { messageHandlers: { rustron: { postMessage: (t) => enviados.push(t) } } } };
  const puente = instalarEnVentana(ventana);
  puente.conectar();
  assert.equal(enviados[0], '{"tipo":"listo"}');
  ventana.__rustronRecibir(JSON.stringify(instantanea));
  assert.equal(puente.listo, true);
  assert.throws(() => instalarEnVentana({}), /manejador de mensajes/);
});

test("pestanasDe sigue el orden de espacios, también tras reordenar o mover", () => {
  const { puente } = crear();
  puente.recibir(JSON.stringify({
    ...instantanea,
    estado: {
      ...instantanea.estado,
      espacios: [{ id: 1, nombre: "A", pestanas: [1, 2, 3] }, { id: 2, nombre: "B", pestanas: [] }],
      pestanas: [pestana(1), pestana(2), pestana(3)],
    },
  }));
  assert.deepEqual(puente.pestanasDe().map((p) => p.id), [1, 2, 3]);
  puente.recibir(JSON.stringify({
    tipo: "espacios",
    espacios: [{ id: 1, nombre: "A", pestanas: [3, 1] }, { id: 2, nombre: "B", pestanas: [2] }],
  }));
  assert.deepEqual(puente.pestanasDe(1).map((p) => p.id), [3, 1]);
  assert.deepEqual(puente.pestanasDe(2).map((p) => p.id), [2]);
  assert.deepEqual(puente.pestanasDe(99), []);
});

test("una petición sin respuesta se rechaza al vencer el límite", async () => {
  const puente = new Puente(() => {}, { limiteMs: 20 });
  await assert.rejects(puente.peticion("leer", { ruta: "a" }), /no obtuvo respuesta en 20 ms/);
});

test("la respuesta a tiempo cancela el límite y llega una sola vez", async () => {
  const enviados = [];
  const puente = new Puente((t) => enviados.push(JSON.parse(t)), { limiteMs: 20 });
  const promesa = puente.peticion("leer", { ruta: "a" });
  puente.recibir(JSON.stringify({ tipo: "respuesta", id: enviados[0].id, ok: true, valor: "x" }));
  assert.equal(await promesa, "x");
  await new Promise((r) => setTimeout(r, 40));
});
