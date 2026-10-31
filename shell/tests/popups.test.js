import test from "node:test";
import assert from "node:assert/strict";

import { calcularPosicion, seSolapan } from "../shim/popups.js";

const ventana = { width: 1000, height: 700 };
const popup = { width: 200, height: 300 };
const ancla = { x: 100, y: 100, width: 40, height: 30 };
const colocar = (posicion, extra = {}) => calcularPosicion({ ancla, popup, ventana, posicion, ...extra });

test("after_start: debajo del ancla y alineado a su izquierda", () => {
  assert.deepEqual(colocar("after_start"), { left: 100, top: 130 });
});

test("after_end alinea la derecha; before_start se abre encima", () => {
  assert.deepEqual(colocar("after_end", { ancla: { ...ancla, x: 500 } }), { left: 500 + 40 - 200, top: 130 });
  assert.deepEqual(colocar("after_end"), { left: 4, top: 130 }, "si no cabe a la izquierda, se empuja al borde");
  assert.deepEqual(colocar("before_start", { ancla: { ...ancla, y: 400 } }), { left: 100, top: 100 });
});

test("end_before: a la derecha y alineado arriba; start_before: a la izquierda", () => {
  assert.deepEqual(colocar("end_before"), { left: 140, top: 100 });
  assert.deepEqual(colocar("start_before", { ancla: { ...ancla, x: 500 } }), { left: 300, top: 100 });
});

test("overlap y los desplazamientos x/y", () => {
  assert.deepEqual(colocar("overlap"), { left: 100, top: 100 });
  assert.deepEqual(colocar("after_start", { x: 10, y: 5 }), { left: 110, top: 135 });
});

test("sin ancla se abre en el punto dado (menú contextual)", () => {
  assert.deepEqual(calcularPosicion({ ancla: null, popup, ventana, x: 300, y: 200 }), { left: 300, top: 200 });
});

test("no se sale de la ventana: se empuja dentro del borde", () => {
  assert.deepEqual(calcularPosicion({ ancla: null, popup, ventana, x: 950, y: 690 }), { left: 796, top: 396 });
  assert.deepEqual(calcularPosicion({ ancla: null, popup, ventana, x: -50, y: -50 }), { left: 4, top: 4 });
});

test("si no cabe debajo, after_* pasa a abrirse encima del ancla", () => {
  assert.deepEqual(colocar("after_start", { ancla: { x: 100, y: 500, width: 40, height: 30 } }), { left: 100, top: 200 });
});

test("si no cabe a la derecha, end_* pasa al lado izquierdo", () => {
  assert.deepEqual(colocar("end_before", { ancla: { x: 900, y: 100, width: 80, height: 30 } }), { left: 700, top: 100 });
});

test("seSolapan", () => {
  assert.equal(seSolapan({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), true);
  assert.equal(seSolapan({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), false);
});
