import test from "node:test";
import assert from "node:assert/strict";

import { normalizarAtajo, coincide, esDeEdicion } from "../shim/atajos.js";

const tecla = (key, extra = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...extra });

test("accel es Ctrl y los modificadores se leen de la lista", () => {
  assert.deepEqual(normalizarAtajo({ key: "T", modifiers: "accel" }), { key: "t", ctrl: true, shift: false, alt: false, meta: false });
  assert.deepEqual(normalizarAtajo({ key: "w", modifiers: "accel,shift" }), { key: "w", ctrl: true, shift: true, alt: false, meta: false });
  assert.deepEqual(normalizarAtajo({ key: "d", modifiers: "alt meta" }), { key: "d", ctrl: false, shift: false, alt: true, meta: true });
});

test("keycode de XUL pasa al nombre de tecla del DOM", () => {
  assert.equal(normalizarAtajo({ keycode: "VK_F5" }).key, "F5");
  assert.equal(normalizarAtajo({ keycode: "VK_TAB", modifiers: "control" }).key, "Tab");
  assert.equal(normalizarAtajo({ keycode: "VK_LEFT", modifiers: "alt" }).key, "ArrowLeft");
  assert.equal(normalizarAtajo({ keycode: "VK_PAGE_DOWN" }).key, "PageDown");
  assert.equal(normalizarAtajo({}), null);
  assert.equal(normalizarAtajo({ keycode: "VK_DESCONOCIDA" }), null);
});

test("coincide exige los modificadores exactos", () => {
  const nuevaPestana = normalizarAtajo({ key: "t", modifiers: "accel" });
  assert.equal(coincide(nuevaPestana, tecla("t", { ctrlKey: true })), true);
  assert.equal(coincide(nuevaPestana, tecla("T", { ctrlKey: true })), true, "mayúscula = misma tecla");
  assert.equal(coincide(nuevaPestana, tecla("t")), false);
  assert.equal(coincide(nuevaPestana, tecla("t", { ctrlKey: true, altKey: true })), false);
  assert.equal(coincide(nuevaPestana, tecla("t", { ctrlKey: true, shiftKey: true })), false, "Ctrl+Shift+T es otro atajo");
  const reabrir = normalizarAtajo({ key: "t", modifiers: "accel,shift" });
  assert.equal(coincide(reabrir, tecla("T", { ctrlKey: true, shiftKey: true })), true);
});

test("el Shift de un símbolo no cuenta (Ctrl++ es Ctrl+Shift+=)", () => {
  const ampliar = normalizarAtajo({ key: "+", modifiers: "accel" });
  assert.equal(coincide(ampliar, tecla("+", { ctrlKey: true, shiftKey: true })), true);
  assert.equal(coincide(ampliar, tecla("+", { ctrlKey: true })), true);
});

test("teclas con nombre: F5, Ctrl+Tab y Alt+Izquierda", () => {
  assert.equal(coincide(normalizarAtajo({ keycode: "VK_F5" }), tecla("F5")), true);
  assert.equal(coincide(normalizarAtajo({ keycode: "VK_TAB", modifiers: "control" }), tecla("Tab", { ctrlKey: true })), true);
  assert.equal(coincide(normalizarAtajo({ keycode: "VK_TAB", modifiers: "control,shift" }), tecla("Tab", { ctrlKey: true })), false);
  assert.equal(coincide(normalizarAtajo({ keycode: "VK_LEFT", modifiers: "alt" }), tecla("ArrowLeft", { altKey: true })), true);
});

test("en un campo de texto mandan el campo y sus atajos de edición", () => {
  assert.equal(esDeEdicion(tecla("a"), true), true, "escribir");
  assert.equal(esDeEdicion(tecla("Backspace"), true), true);
  assert.equal(esDeEdicion(tecla("c", { ctrlKey: true }), true), true, "copiar");
  assert.equal(esDeEdicion(tecla("t", { ctrlKey: true }), true), false, "Ctrl+T sigue siendo de la ventana");
  assert.equal(esDeEdicion(tecla("F5"), true), true, "sin Ctrl/Alt: del campo");
  assert.equal(esDeEdicion(tecla("a"), false), false, "fuera de un campo no hay edición");
});
