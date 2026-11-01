import test from "node:test";
import assert from "node:assert/strict";

import { crearComandos, instalarComandos } from "../shim/comandos.js";

test("los comandos del anfitrión se convierten en órdenes de vista para Rust", () => {
  const enviados = [];
  const comandos = crearComandos((m) => enviados.push(m));
  for (const id of ["cmd_quitApplication", "cmd_closeWindow", "View:FullScreen", "Browser:Stop", "cmd_fullZoomEnlarge", "cmd_fullZoomReduce", "cmd_fullZoomReset"]) {
    comandos[id]();
  }
  assert.deepEqual(enviados.map((m) => m.orden), ["salir", "salir", "pantalla-completa", "detener", "zoom-mas", "zoom-menos", "zoom-reset"]);
  assert.ok(enviados.every((m) => m.tipo === "vista"));
});

test("el resto de comandos (nueva pestaña, cerrar, recargar...) no son de aquí: los atiende Firefox", () => {
  const comandos = crearComandos(() => {});
  for (const id of ["cmd_newNavigatorTab", "cmd_close", "Browser:Back", "Browser:Reload", "Browser:OpenLocation"]) {
    assert.equal(id in comandos, false, id);
  }
});

test("un comando propio corta el evento (en captura) y uno ajeno sigue su camino", () => {
  const oyentes = [];
  const ventana = { document: { addEventListener: (tipo, f, captura) => oyentes.push({ tipo, f, captura }) } };
  const enviados = [];
  instalarComandos(ventana, (m) => enviados.push(m));
  assert.equal(oyentes.length, 1);
  assert.equal(oyentes[0].tipo, "command");
  assert.equal(oyentes[0].captura, true, "en captura, antes que el oyente real del commandset");
  let cortado = 0;
  oyentes[0].f({ target: { id: "Browser:Stop" }, stopPropagation: () => cortado++ });
  assert.equal(cortado, 1);
  assert.equal(enviados.length, 1);
  oyentes[0].f({ target: { id: "cmd_newNavigatorTab" }, stopPropagation: () => cortado++ });
  assert.equal(cortado, 1, "no se corta: lo atiende el código real");
  assert.equal(enviados.length, 1);
});
