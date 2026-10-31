import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { DeferredTask } from "../shim/modulos/DeferredTask.sys.mjs";
import { JSONFile, usarAlmacenamiento } from "../shim/modulos/JSONFile.sys.mjs";
import { PrivateBrowsingUtils } from "../shim/modulos/PrivateBrowsingUtils.sys.mjs";
import { AppConstants } from "../shim/modulos/AppConstants.sys.mjs";
import { NetUtil } from "../shim/modulos/NetUtil.sys.mjs";
import { setTimeout as setTimeoutModulo, clearTimeout as clearTimeoutModulo } from "../shim/modulos/Timer.sys.mjs";

function conTiempoSimulado(cuerpo) {
  return async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      await cuerpo();
    } finally {
      mock.timers.reset();
    }
  };
}

const vaciarMicrotareas = () => new Promise((r) => setImmediate(r));

test("Timer delega en los temporizadores del entorno", conTiempoSimulado(() => {
  let n = 0;
  const id = setTimeoutModulo(() => n++, 100);
  mock.timers.tick(100);
  assert.equal(n, 1);
  const cancelado = setTimeoutModulo(() => n++, 100);
  clearTimeoutModulo(cancelado);
  mock.timers.tick(100);
  assert.equal(n, 1);
  assert.ok(id);
}));

test("DeferredTask: arm ejecuta una vez tras el retraso y arm repetido no reinicia", conTiempoSimulado(async () => {
  let n = 0;
  const tarea = new DeferredTask(() => { n++; }, 100);
  tarea.arm();
  mock.timers.tick(60);
  tarea.arm();
  assert.ok(tarea.isArmed);
  mock.timers.tick(40);
  await vaciarMicrotareas();
  assert.equal(n, 1);
  assert.ok(!tarea.isArmed);
}));

test("DeferredTask: disarm cancela y finalize ejecuta lo pendiente al instante", conTiempoSimulado(async () => {
  let n = 0;
  const tarea = new DeferredTask(() => { n++; }, 100);
  tarea.arm();
  tarea.disarm();
  mock.timers.tick(200);
  await vaciarMicrotareas();
  assert.equal(n, 0);

  tarea.arm();
  await tarea.finalize();
  assert.equal(n, 1);
  assert.throws(() => tarea.arm(), /finalizada/);
}));

test("DeferredTask: armar mientras corre la vuelve a programar al terminar", conTiempoSimulado(async () => {
  let n = 0;
  let tarea;
  tarea = new DeferredTask(async () => {
    n++;
    if (n === 1) {
      tarea.arm();
    }
  }, 50);
  tarea.arm();
  mock.timers.tick(50);
  await vaciarMicrotareas();
  assert.equal(n, 1);
  assert.ok(tarea.isArmed);
  mock.timers.tick(50);
  await vaciarMicrotareas();
  assert.equal(n, 2);
}));

function memoria(inicial = {}) {
  const archivos = new Map(Object.entries(inicial));
  usarAlmacenamiento({
    leer: async (ruta) => archivos.get(ruta) ?? null,
    leerSync: (ruta) => archivos.get(ruta) ?? null,
    escribir: async (ruta, texto) => { archivos.set(ruta, texto); },
  });
  return archivos;
}

test("JSONFile: un archivo inexistente carga como objeto vacío", async () => {
  memoria();
  const f = new JSONFile({ path: "/p/a.json" });
  assert.throws(() => f.data, /no se han cargado/);
  await f.load();
  assert.deepEqual(f.data, {});
  assert.ok(f.dataReady);
});

test("JSONFile: lee, aplica dataPostProcessor y tolera JSON corrupto", async () => {
  memoria({ "/p/a.json": '{"version":1}', "/p/mala.json": "{no es json" });
  const f = new JSONFile({
    path: "/p/a.json",
    dataPostProcessor(d) { d.version = 2; return d; },
  });
  await f.load();
  assert.equal(f.data.version, 2);

  const mala = new JSONFile({ path: "/p/mala.json" });
  await mala.load();
  assert.deepEqual(mala.data, {});
});

test("JSONFile: saveSoon guarda con retraso, _save y backupTo escriben", conTiempoSimulado(async () => {
  const archivos = memoria();
  const f = new JSONFile({ path: "/p/s.json", backupTo: "/p/s.bak" });
  await f.load();
  f.data.x = 1;
  f.saveSoon();
  assert.equal(archivos.has("/p/s.json"), false);
  mock.timers.tick(1500);
  await vaciarMicrotareas();
  assert.equal(archivos.get("/p/s.json"), '{"x":1}');
  assert.equal(archivos.get("/p/s.bak"), '{"x":1}');

  f.data = { y: 2 };
  await f._save();
  assert.equal(archivos.get("/p/s.json"), '{"y":2}');
}));

test("JSONFile: ensureDataReady lee en sincrónico y finalize guarda lo pendiente", conTiempoSimulado(async () => {
  const archivos = memoria({ "/p/e.json": '{"a":1}' });
  const f = new JSONFile({ path: "/p/e.json" });
  f.ensureDataReady();
  assert.equal(f.data.a, 1);
  f.data.a = 2;
  f.saveSoon();
  await f.finalize();
  assert.equal(archivos.get("/p/e.json"), '{"a":2}');
}));

test("PrivateBrowsingUtils, AppConstants y NetUtil", () => {
  assert.equal(PrivateBrowsingUtils.isWindowPrivate({ privado: true }), true);
  assert.equal(PrivateBrowsingUtils.isWindowPrivate({}), false);
  assert.equal(PrivateBrowsingUtils.isWindowPrivate(null), false);
  assert.equal(PrivateBrowsingUtils.permanentPrivateBrowsing, false);
  assert.equal(AppConstants.platform, "linux");
  assert.equal(NetUtil.newURI("https://a.com/x").host, "a.com");
  assert.equal(NetUtil.newURI("/y", null, NetUtil.newURI("https://a.com/x")).spec, "https://a.com/y");
  assert.throws(() => NetUtil.newChannel({}), /NS_ERROR_NOT_IMPLEMENTED/);
});
