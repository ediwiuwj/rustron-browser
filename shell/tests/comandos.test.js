import test from "node:test";
import assert from "node:assert/strict";

import { crearComandos } from "../shim/comandos.js";

function montar({ selectedTab = { rustronId: 3 }, handleNewTab } = {}) {
  const llamadas = [];
  const enviados = [];
  const ventana = {
    gBrowser: {
      selectedTab,
      goBack: () => llamadas.push("atras"),
      goForward: () => llamadas.push("adelante"),
      reload: (o) => llamadas.push(["recargar", o ?? null]),
      removeTab: (t) => llamadas.push(["cerrar", t.rustronId]),
      addTab: (u) => llamadas.push(["nueva", u]),
      tabContainer: { advanceSelectedTab: (d, w) => llamadas.push(["avanzar", d, w]) },
    },
    gZenUIManager: handleNewTab ? { handleNewTab } : undefined,
    gURLBar: { focus: () => llamadas.push("foco"), select: () => llamadas.push("seleccionar") },
    document: { getElementById: () => null },
  };
  return { comandos: crearComandos(ventana, (m) => enviados.push(m)), llamadas, enviados };
}

test("navegación: atrás, adelante y recargar actúan sobre la pestaña activa", () => {
  const { comandos, llamadas } = montar();
  comandos["Browser:Back"]();
  comandos["Browser:Forward"]();
  comandos["Browser:Reload"]();
  comandos["Browser:ReloadSkipCache"]();
  assert.deepEqual(llamadas, ["atras", "adelante", ["recargar", null], ["recargar", { forzar: true }]]);
});

test("sin pestaña de Rust (marcador vacío de Zen) la navegación no hace nada", () => {
  const { comandos, llamadas } = montar({ selectedTab: { rustronId: null } });
  comandos["Browser:Back"]();
  comandos["Browser:Reload"]();
  comandos.cmd_close();
  assert.deepEqual(llamadas, []);
});

test("cmd_close cierra la activa; cmd_newNavigatorTab deja decidir a Zen y si no, abre una en blanco", () => {
  const a = montar();
  a.comandos.cmd_close();
  a.comandos.cmd_newNavigatorTab();
  assert.deepEqual(a.llamadas, [["cerrar", 3], ["nueva", "about:blank"]]);
  const b = montar({ handleNewTab: () => true });
  b.comandos.cmd_newNavigatorTab();
  assert.deepEqual(b.llamadas, [], "Zen lo gestionó (su barra flotante)");
});

test("órdenes de ventana van a Rust por `enviar`", () => {
  const { comandos, enviados } = montar();
  comandos.cmd_quitApplication();
  comandos["View:FullScreen"]();
  comandos.cmd_fullZoomEnlarge();
  comandos["Browser:Stop"]();
  assert.deepEqual(enviados.map((m) => m.orden), ["salir", "pantalla-completa", "zoom-mas", "detener"]);
  assert.ok(enviados.every((m) => m.tipo === "vista"));
});

test("pestaña siguiente/anterior y foco de la barra de direcciones", () => {
  const { comandos, llamadas } = montar();
  comandos["Browser:NextTab"]();
  comandos["Browser:PrevTab"]();
  comandos["Browser:OpenLocation"]();
  assert.deepEqual(llamadas, [["avanzar", 1, true], ["avanzar", -1, true], "foco", "seleccionar"]);
});
