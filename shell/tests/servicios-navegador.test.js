import test from "node:test";
import assert from "node:assert/strict";

import { crearETLD, crearTextToSubURI, crearLocale, crearXulStore, ampliarIO } from "../shim/servicios-navegador.js";
import { nuevaURI } from "../shim/uri.js";

test("eTLD: dominio base y sufijo, con sufijos de dos etiquetas y direcciones IP", () => {
  const e = crearETLD();
  assert.equal(e.getBaseDomainFromHost("www.zen-browser.app"), "zen-browser.app");
  assert.equal(e.getBaseDomainFromHost("a.b.example.co.uk"), "example.co.uk");
  assert.equal(e.getKnownPublicSuffixFromHost("foo.com.mx"), "com.mx");
  assert.throws(() => e.getBaseDomainFromHost("10.0.0.1"), /HOST_IS_IP/);
  assert.throws(() => e.getBaseDomainFromHost("localhost"), /INSUFFICIENT/);
  assert.equal(e.getSchemelessSite(nuevaURI("https://www.zen.org/x")), "zen.org");
  assert.equal(e.getSchemelessSite(nuevaURI("http://localhost:3000/")), "localhost");
});

test("textToSubURI: descodifica para mostrar sin cambiar el significado de la dirección", () => {
  const t = crearTextToSubURI();
  assert.equal(t.unEscapeURIForUI("https://x.org/a%20b%C3%B1"), "https://x.org/a bñ");
  assert.equal(t.unEscapeURIForUI("https://x.org/?q=a%26b%25"), "https://x.org/?q=a%26b%25");
  assert.equal(t.unEscapeURIForUI("%E0%A4%A"), "%E0%A4%A", "UTF-8 inválido: se deja");
  assert.equal(t.unEscapeURIForUI("a%0Ab"), "a%0Ab", "un salto de línea no se muestra");
});

test("locale, xulStore e io.createExposableURI", () => {
  const l = crearLocale({ navigator: { languages: ["es-MX", "en"] } });
  assert.equal(l.appLocaleAsBCP47, "es-MX");
  assert.deepEqual(l.regionalPrefsLocales, ["es-MX"]);
  const x = crearXulStore();
  assert.equal(x.getValue("u", "id", "width"), "");
  x.setValue("u", "id", "width", 180);
  assert.equal(x.getValue("u", "id", "width"), "180");
  const io = ampliarIO({}, nuevaURI);
  assert.equal(io.createExposableURI(nuevaURI("https://user:pw@zen.org/a")).spec, "https://zen.org/a");
  const limpia = nuevaURI("https://zen.org/a");
  assert.equal(io.createExposableURI(limpia), limpia);
});

test("nsITimer: una vez, repetido y cancelado", async () => {
  const { crearTimer, TIPOS_DE_TIMER } = await import("../shim/servicios-navegador.js");
  const timer = crearTimer(globalThis);
  let veces = 0;
  await new Promise((resolver) => {
    timer.initWithCallback(() => { veces++; resolver(); }, 5, TIPOS_DE_TIMER.TYPE_ONE_SHOT);
  });
  assert.equal(veces, 1);
  const repetido = crearTimer(globalThis);
  let cuenta = 0;
  await new Promise((resolver) => {
    repetido.initWithCallback({ notify: () => { if (++cuenta === 3) { repetido.cancel(); resolver(); } } }, 3, TIPOS_DE_TIMER.TYPE_REPEATING_SLACK);
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cuenta, 3, "cancelado: no sigue contando");
  const cancelado = crearTimer(globalThis);
  let disparado = false;
  cancelado.initWithCallback(() => (disparado = true), 5, 0);
  cancelado.cancel();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(disparado, false);
});
