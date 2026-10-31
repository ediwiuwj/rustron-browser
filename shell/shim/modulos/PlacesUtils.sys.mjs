// Este Source Code Form está sujeto a los términos de la Mozilla Public License, v. 2.0.
// Si no se distribuyó una copia de la MPL con este archivo, puede obtenerse en https://mozilla.org/MPL/2.0/.
// Contiene código adaptado de Mozilla Firefox (MPL-2.0, © Mozilla Corporation y colaboradores): toPRTime, toDate y los valores de TYPE_*
//
// Sustituye a PlacesUtils (historial, marcadores, favicons sobre SQLite). Rustron aún no tiene
// base de datos de lugares: aquí solo van las constantes y las conversiones puras que Zen
// usa. Lo que necesita datos (promiseDBConnection, history.insertMany, favicons.getFaviconForPage,
// bookmarks.insertTree...) no existe a propósito: fallará a la vista y marcará qué servicio de Rust
// hay que construir (M5).

const TRANSITION = {
  // Valores de nsINavHistoryService (no están en el JS de Firefox, vienen del .idl; de memoria).
  LINK: 1,
  TYPED: 2,
  BOOKMARK: 3,
  EMBED: 4,
  REDIRECT_PERMANENT: 5,
  REDIRECT_TEMPORARY: 6,
  DOWNLOAD: 7,
  FRAMED_LINK: 8,
  RELOAD: 9,
};

export const PlacesUtils = {
  // Igual que Firefox: la fecha o los milisegundos pasan a microsegundos desde la época.
  toPRTime(fecha) {
    if (fecha?.constructor?.name === "Date" && !isNaN(fecha.getTime())) {
      return fecha.getTime() * 1000;
    }
    if (typeof fecha === "number" && !isNaN(fecha)) {
      return fecha * 1000;
    }
    throw new Error("Invalid value passed to toPRTime");
  },

  toDate(tiempo) {
    if (typeof tiempo !== "number" || isNaN(tiempo)) {
      throw new Error("Invalid value passed to toDate");
    }
    return new Date(Math.trunc(tiempo / 1000));
  },

  bookmarks: { TYPE_BOOKMARK: 1, TYPE_FOLDER: 2, TYPE_SEPARATOR: 3 },
  history: { TRANSITIONS: Object.freeze(TRANSITION) },
  favicons: { defaultFavicon: { spec: "chrome://global/skin/icons/defaultFavicon.svg" } },
};
