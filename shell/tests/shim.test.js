import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { crearServices } from "../shim/services.js";
import { crearXPCOMUtils } from "../shim/xpcom-utils.js";
import { RegistroModulos, crearChromeUtils } from "../shim/chrome-utils.js";
import { PREF_BOOL, PREF_INT, PREF_INVALID, PREF_STRING } from "../shim/prefs.js";

const defaultsReales = JSON.parse(
  readFileSync(new URL("../shim/prefs-defaults.json", import.meta.url), "utf8")
);

test("lee los valores por defecto reales de Zen con su tipo", () => {
  const { prefs } = crearServices(defaultsReales);
  assert.equal(prefs.getBoolPref("zen.tabs.vertical"), true);
  assert.equal(prefs.getStringPref("zen.glance.activation-method"), "alt");
  assert.equal(prefs.getIntPref("zen.theme.border-radius"), -1);
  assert.equal(prefs.getPrefType("zen.tabs.vertical"), PREF_BOOL);
  assert.equal(prefs.getPrefType("zen.glance.animation-duration"), PREF_INT);
  assert.equal(prefs.getPrefType("zen.urlbar.behavior"), PREF_STRING);
  assert.equal(prefs.getPrefType("no.existe"), PREF_INVALID);
});

test("una preferencia inexistente lanza, salvo que se dé valor por defecto", () => {
  const { prefs } = crearServices({});
  assert.throws(() => prefs.getBoolPref("a.b"), /NS_ERROR_UNEXPECTED/);
  assert.equal(prefs.getBoolPref("a.b", true), true);
  assert.equal(prefs.getIntPref("a.c", 7), 7);
});

test("los tipos son estrictos como en Firefox", () => {
  const { prefs } = crearServices({ "a.bool": true, "a.int": 3 });
  assert.throws(() => prefs.getIntPref("a.bool"), /NS_ERROR_UNEXPECTED/);
  assert.throws(() => prefs.setStringPref("a.bool", "x"), /NS_ERROR_UNEXPECTED/);
  assert.throws(() => prefs.setIntPref("a.int", 1.5), /NS_ERROR_ILLEGAL_VALUE/);
});

test("el valor de usuario tapa al defecto, y volver al defecto lo borra", () => {
  const { prefs } = crearServices({ "a.n": 1 });
  prefs.setIntPref("a.n", 5);
  assert.equal(prefs.getIntPref("a.n"), 5);
  assert.equal(prefs.prefHasUserValue("a.n"), true);
  prefs.setIntPref("a.n", 1);
  assert.equal(prefs.prefHasUserValue("a.n"), false);
  prefs.setIntPref("a.n", 9);
  prefs.clearUserPref("a.n");
  assert.equal(prefs.getIntPref("a.n"), 1);
});

test("los observadores reciben cambios, también por prefijo", () => {
  const { prefs } = crearServices({ "zen.view.a": false, "zen.view.b": false });
  const visto = [];
  prefs.addObserver("zen.view.", (rama, tema, nombre) => visto.push([tema, nombre]));
  prefs.setBoolPref("zen.view.a", true);
  prefs.setBoolPref("zen.view.a", true); // sin cambio: no notifica
  prefs.setBoolPref("zen.view.b", true);
  assert.deepEqual(visto, [
    ["nsPref:changed", "zen.view.a"],
    ["nsPref:changed", "zen.view.b"],
  ]);
});

test("removeObserver deja de notificar", () => {
  const { prefs } = crearServices({ "x.y": 0 });
  let cuenta = 0;
  const obs = { observe: () => cuenta++ };
  prefs.addObserver("x.y", obs);
  prefs.setIntPref("x.y", 1);
  prefs.removeObserver("x.y", obs);
  prefs.setIntPref("x.y", 2);
  assert.equal(cuenta, 1);
});

test("getBranch usa nombres relativos y notifica con nombres relativos", () => {
  const { prefs } = crearServices({ "zen.tabs.vertical": true });
  const rama = prefs.getBranch("zen.tabs.");
  assert.equal(rama.getBoolPref("vertical"), true);
  const vistos = [];
  rama.addObserver("", (r, t, n) => vistos.push(n));
  prefs.setBoolPref("zen.tabs.vertical", false);
  assert.deepEqual(vistos, ["vertical"]);
  assert.deepEqual(rama.getChildList(""), ["vertical"]);
});

test("Services.obs entrega notificaciones por tema", () => {
  const { obs } = crearServices({});
  const recibido = [];
  const o = { observe: (s, t, d) => recibido.push([s, t, d]) };
  obs.addObserver(o, "zen-tema");
  obs.notifyObservers("sujeto", "zen-tema", "datos");
  obs.notifyObservers("otro", "otro-tema", "nada");
  obs.removeObserver(o, "zen-tema");
  obs.notifyObservers("x", "zen-tema", "y");
  assert.deepEqual(recibido, [["sujeto", "zen-tema", "datos"]]);
});

test("defineLazyPreferenceGetter lee perezoso, cachea y se actualiza", () => {
  const Services = crearServices({ "zen.glance.enabled": true, "zen.n": 2 });
  const XPCOMUtils = crearXPCOMUtils(Services);
  const objeto = {};
  const cambios = [];
  XPCOMUtils.defineLazyPreferenceGetter(objeto, "glance", "zen.glance.enabled", false, (p, ant, nuevo) =>
    cambios.push([p, ant, nuevo])
  );
  XPCOMUtils.defineLazyPreferenceGetter(objeto, "doble", "zen.n", 0, null, (v) => v * 2);
  assert.equal(objeto.glance, true);
  assert.equal(objeto.doble, 4);
  Services.prefs.setBoolPref("zen.glance.enabled", false);
  assert.equal(objeto.glance, false);
  assert.deepEqual(cambios, [["zen.glance.enabled", true, false]]);
});

test("defineLazyPreferenceGetter usa el valor por defecto si la preferencia no existe", () => {
  const Services = crearServices({});
  const XPCOMUtils = crearXPCOMUtils(Services);
  const o = {};
  XPCOMUtils.defineLazyPreferenceGetter(o, "x", "no.existe", 42);
  assert.equal(o.x, 42);
});

test("ChromeUtils.defineLazyGetter calcula una sola vez", () => {
  const registro = new RegistroModulos([]);
  const ChromeUtils = crearChromeUtils(registro);
  let llamadas = 0;
  const o = {};
  ChromeUtils.defineLazyGetter(o, "caro", () => ++llamadas);
  assert.equal(o.caro, 1);
  assert.equal(o.caro, 1);
  assert.equal(llamadas, 1);
});

test("importESModule sirve módulos precargados y falla si no lo están", async () => {
  const registro = new RegistroModulos(
    [
      ["chrome://browser/content/", "file:///app/chrome/browser/"],
      ["resource:///modules/zen/", "file:///app/modules/zen/"],
    ],
    async (url) => ({ origen: url })
  );
  const ChromeUtils = crearChromeUtils(registro);
  assert.throws(() => ChromeUtils.importESModule("chrome://browser/content/a.mjs"), /no precargado/);
  await registro.precargar(["chrome://browser/content/a.mjs", "resource:///modules/zen/B.mjs"]);
  assert.equal(
    ChromeUtils.importESModule("chrome://browser/content/a.mjs").origen,
    "file:///app/chrome/browser/a.mjs"
  );
  assert.equal(
    ChromeUtils.importESModule("resource:///modules/zen/B.mjs").origen,
    "file:///app/modules/zen/B.mjs"
  );
  assert.throws(() => registro.resolver("otro://x"), /sin mapeo/);
});

test("defineESModuleGetters resuelve la exportación por nombre", async () => {
  const registro = new RegistroModulos([["resource://m/", "file:///m/"]], async () => ({ Cosa: 123 }));
  await registro.precargar(["resource://m/Cosa.sys.mjs"]);
  const ChromeUtils = crearChromeUtils(registro);
  const o = {};
  ChromeUtils.defineESModuleGetters(o, { Cosa: "resource://m/Cosa.sys.mjs" });
  assert.equal(o.Cosa, 123);
});
