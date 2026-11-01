import test from "node:test";
import assert from "node:assert/strict";

import { crearUriFixup, pareceSitio, FLAGS_DE_FIXUP as F } from "../shim/uri-fixup.js";

const motor = {
  name: "DuckDuckGo",
  getSubmission: (texto) => ({ uri: { spec: `https://duckduckgo.com/?q=${encodeURIComponent(texto)}` }, postData: null }),
};
const fixup = crearUriFixup(() => motor);
const BUSCAR = F.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP | F.FIXUP_FLAG_FIX_SCHEME_TYPOS;

test("qué parece un sitio y qué una palabra", () => {
  for (const s of ["zen.org", "www.zen-browser.app/x?y=1", "localhost", "localhost:8080/a", "10.0.0.1", "[::1]:80", "miservidor:3000"]) {
    assert.equal(pareceSitio(s), true, s);
  }
  for (const s of ["zen", "rust lang", "qué tal", "zen browser descargar", "a b.com"]) {
    assert.equal(pareceSitio(s), false, s);
  }
});

test("con esquema, la dirección es esa", () => {
  const i = fixup.getFixupURIInfo("https://zen.org/a", BUSCAR);
  assert.equal(i.preferredURI.spec, "https://zen.org/a");
  assert.equal(i.fixupChangedProtocol, false);
  assert.equal(fixup.getFixupURIInfo("about:blank", BUSCAR).preferredURI.spec, "about:blank");
});

test("sin esquema, un sitio lleva https://", () => {
  const i = fixup.getFixupURIInfo("zen-browser.app", BUSCAR);
  assert.equal(i.preferredURI.spec, "https://zen-browser.app/");
  assert.equal(i.fixupChangedProtocol, true);
  assert.equal(i.wasSchemelessInput, true);
  assert.equal(i.keywordAsSent, "");
});

test("una frase es una búsqueda con el buscador predeterminado", () => {
  const i = fixup.getFixupURIInfo("rust lang", BUSCAR);
  assert.equal(i.preferredURI.spec, "https://duckduckgo.com/?q=rust%20lang");
  assert.equal(i.keywordAsSent, "rust lang");
  assert.equal(i.keywordProviderName, "DuckDuckGo");
  assert.equal(i.fixedURI, null, "con espacios no puede ser un sitio");
});

test("una palabra suelta es una búsqueda pero también un posible sitio de la red local", () => {
  const i = fixup.getFixupURIInfo("zen", BUSCAR);
  assert.equal(i.preferredURI.spec, "https://duckduckgo.com/?q=zen");
  assert.equal(i.fixedURI.spec, "https://zen/");
});

test("sin permiso de búsqueda, lo que no es una dirección es un error", () => {
  assert.throws(() => fixup.getFixupURIInfo("rust lang", 0), /NS_ERROR_MALFORMED_URI/);
  assert.throws(() => fixup.getFixupURIInfo("   ", BUSCAR), /NS_ERROR_FAILURE/);
});

test("isDomainKnown", () => {
  assert.equal(fixup.isDomainKnown("zen.org"), true);
  assert.equal(fixup.isDomainKnown("localhost"), true);
  assert.equal(fixup.isDomainKnown("zen"), false);
});
