// NetUtil: solo newURI. newChannel y readInputStream dependen de la red de Rust y
// llegan con el puente de M2; mientras tanto fallan con un error claro.

import { nuevaURI } from "../uri.js";

function pendiente(nombre) {
  return () => {
    throw Object.assign(new Error(`NS_ERROR_NOT_IMPLEMENTED: NetUtil.${nombre} llega con M2`), {
      result: "NS_ERROR_NOT_IMPLEMENTED",
    });
  };
}

export const NetUtil = {
  newURI: (spec, _charset, base) => nuevaURI(spec, base),
  newChannel: pendiente("newChannel"),
  readInputStream: pendiente("readInputStream"),
};
