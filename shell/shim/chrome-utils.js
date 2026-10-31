// ChromeUtils y registro de módulos.
//
// En Firefox, importESModule es síncrono. El navegador solo ofrece import() asíncrono,
// así que los módulos se precargan antes de arrancar y luego se sirven desde la caché.

export class RegistroModulos {
  #mapas;
  #cargador;
  #cache = new Map();

  // mapas: [[prefijoOrigen, prefijoDestino], ...]; cargador: (url) => Promise<modulo>
  constructor(mapas, cargador = (url) => import(url)) {
    this.#mapas = [...mapas].sort((a, b) => b[0].length - a[0].length);
    this.#cargador = cargador;
  }

  resolver(url) {
    for (const [origen, destino] of this.#mapas) {
      if (url.startsWith(origen)) {
        // Una hoja importada con `type: "css"` llega como módulo JS (la reescritura la hace servir-zen.py).
        return destino + url.slice(origen.length) + (url.endsWith(".css") ? "?hoja" : "");
      }
    }
    throw new Error(`URL de módulo sin mapeo: ${url}`);
  }

  async precargar(urls) {
    await Promise.all(
      urls.map(async (url) => {
        if (!this.#cache.has(url)) {
          this.#cache.set(url, await this.#cargador(this.resolver(url)));
        }
      })
    );
  }

  estaCargado(url) {
    return this.#cache.has(url);
  }

  importar(url) {
    if (!this.#cache.has(url)) {
      throw new Error(`Módulo no precargado: ${url}`);
    }
    return this.#cache.get(url);
  }
}

// Las funciones que devuelve generateQI: MozQueryInterface.isInstance las reconoce.
export const funcionesQI = new WeakSet();

export function crearChromeUtils(registro) {
  return {
    // Devuelve un QueryInterface que acepta las interfaces dadas (y nsISupports).
    generateQI(interfaces) {
      const nombres = new Set(["nsISupports", ...interfaces.map((i) => (typeof i === "string" ? i : i?.nombre))]);
      const QueryInterface = function (iid) {
        const nombre = typeof iid === "string" ? iid : iid?.nombre;
        if (nombres.has(nombre)) {
          return this;
        }
        throw Object.assign(new Error("NS_ERROR_NO_INTERFACE"), { result: "NS_ERROR_NO_INTERFACE" });
      };
      funcionesQI.add(QueryInterface);
      return QueryInterface;
    },

    // Anti-huella digital: Rustron no lo aplica (WebKit lo gestiona por su cuenta).
    shouldResistFingerprinting: () => false,

    importESModule(url) {
      return registro.importar(url);
    },

    defineLazyGetter(objeto, nombre, calcular) {
      Object.defineProperty(objeto, nombre, {
        configurable: true,
        enumerable: true,
        get() {
          const valor = calcular.call(objeto);
          Object.defineProperty(objeto, nombre, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: valor,
          });
          return valor;
        },
      });
    },

    defineESModuleGetters(objeto, mapa) {
      for (const [nombre, url] of Object.entries(mapa)) {
        this.defineLazyGetter(objeto, nombre, () => registro.importar(url)[nombre]);
      }
    },
  };
}
