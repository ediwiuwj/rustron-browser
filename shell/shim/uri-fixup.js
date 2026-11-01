// nsIURIFixup (Services.uriFixup): convierte lo que el usuario escribe en una dirección o en una búsqueda.
// Firefox lo implementa en C++ (URIFixup.cpp); aquí van las reglas que usa la barra de direcciones:
// - con un esquema explícito (https:, about:, file:...) la dirección es esa;
// - sin esquema, algo que parece un sitio (dominio con punto, localhost, IP, host:puerto) lleva https://;
// - lo demás, si se permite la búsqueda por palabra clave, es una búsqueda con el buscador predeterminado.
// Se antepone https y no http (como la resolución de la barra en Rust): no hay "primero HTTPS" aparte.

import { nuevaURI } from "./uri.js";

// Valores propios: solo importa que el código de Firefox y este módulo hablen de lo mismo.
export const FLAGS_DE_FIXUP = {
  FIXUP_FLAG_NONE: 0,
  FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP: 1,
  FIXUP_FLAG_FIX_SCHEME_TYPOS: 2,
  FIXUP_FLAG_PRIVATE_CONTEXT: 4,
  FIXUP_FLAGS_MAKE_ALTERNATE_URI: 8,
  FIXUP_FLAG_REQUIRE_WHITELISTED_HOST: 16,
  FIXUP_FLAG_FORCE_ALTERNATE_URI: 32,
};

const ESQUEMAS_CONOCIDOS = new Set([
  "http", "https", "ftp", "file", "about", "data", "javascript", "view-source", "blob", "mailto", "chrome",
  "resource", "moz-extension", "ws", "wss", "tel", "sms", "irc", "ircs", "magnet", "moz-src",
]);

const error = (codigo, mensaje) => Object.assign(new Error(`${codigo}: ${mensaje}`), { result: codigo });

// ¿Parece un sitio sin esquema? `zen` no (es una palabra), `zen.org`, `localhost`, `10.0.0.1`, `host:8080` sí.
export function pareceSitio(texto) {
  if (/\s/.test(texto.split(/[/?#]/)[0])) {
    return false;
  }
  const autoridad = texto.split(/[/?#]/)[0];
  if (/^localhost(:\d+)?$/i.test(autoridad) || /^\[[0-9a-f:.]+\](:\d+)?$/i.test(autoridad)) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(autoridad)) {
    return true;
  }
  if (/^[^\s.:]+:\d+$/.test(autoridad)) {
    return true; // host:puerto
  }
  return /^[^\s.@:]+(\.[^\s.@:]+)*\.([a-z]{2,}|xn--[a-z0-9-]+)(:\d+)?$/i.test(autoridad);
}

// obtenerMotor() -> el buscador predeterminado ({ name, getSubmission(texto) -> { uri, postData } }).
export function crearUriFixup(obtenerMotor) {
  const info = (entrada, partes = {}) => ({
    originalInput: entrada,
    fixedURI: null,
    preferredURI: null,
    fixupChangedProtocol: false,
    fixupCreatedAlternateURI: false,
    wasSchemelessInput: false,
    keywordProviderName: "",
    keywordAsSent: "",
    postData: null,
    consumer: null,
    ...partes,
  });

  const busqueda = (entrada, texto) => {
    const motor = obtenerMotor();
    const envio = motor.getSubmission(texto);
    return info(entrada, {
      preferredURI: envio.uri,
      postData: envio.postData ?? null,
      keywordProviderName: motor.name,
      keywordAsSent: texto,
    });
  };

  return {
    ...FLAGS_DE_FIXUP,

    getFixupURIInfo(entrada, flags = 0) {
      const texto = String(entrada).trim().replace(/[\r\n\t]/g, "");
      if (!texto) {
        throw error("NS_ERROR_FAILURE", "dirección vacía");
      }
      const esquema = /^([a-z][a-z0-9+.-]*):/i.exec(texto)?.[1]?.toLowerCase();
      // `host:puerto` se parece a un esquema, pero un esquema no va seguido de un número y nada más.
      const esHostPuerto = /^[^\s:/]+:\d+([/?#].*)?$/.test(texto);
      if (esquema && !esHostPuerto && (ESQUEMAS_CONOCIDOS.has(esquema) || texto.startsWith(`${esquema}://`))) {
        const uri = nuevaURI(texto);
        return info(entrada, { fixedURI: uri, preferredURI: uri });
      }
      if (pareceSitio(texto)) {
        const uri = nuevaURI(`https://${texto}`);
        return info(entrada, { fixedURI: uri, preferredURI: uri, fixupChangedProtocol: true, wasSchemelessInput: true });
      }
      if (flags & FLAGS_DE_FIXUP.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP) {
        const resultado = busqueda(entrada, texto);
        // Una sola palabra también podría ser un sitio de la red local (`zen` -> https://zen/).
        if (!/\s/.test(texto) && /^[^/?#:@]+$/.test(texto)) {
          try {
            resultado.fixedURI = nuevaURI(`https://${texto}`);
            resultado.wasSchemelessInput = true;
          } catch {
            // no es un nombre de host válido: solo hay búsqueda
          }
        }
        return resultado;
      }
      throw error("NS_ERROR_MALFORMED_URI", `no es una dirección: ${texto}`);
    },

    createFixupURI(entrada, flags = 0) {
      return this.getFixupURIInfo(entrada, flags).preferredURI;
    },

    keywordToURI(palabra) {
      return busqueda(palabra, palabra);
    },

    // Firefox consulta si el dominio existe de verdad (lista de sufijos públicos); aquí basta con que tenga forma de
    // dominio con un sufijo alfabético, o sea `localhost`.
    isDomainKnown(dominio) {
      return dominio === "localhost" || /\.([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(dominio);
    },
  };
}
