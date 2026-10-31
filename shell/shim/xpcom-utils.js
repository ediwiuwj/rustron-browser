// XPCOMUtils: solo lo que usa Zen (defineLazyPreferenceGetter, 17 usos).

import { PREF_BOOL, PREF_INT, PREF_STRING } from "./prefs.js";

export function crearXPCOMUtils(Services) {
  const utils = {
    defineLazyPreferenceGetter(
      objeto,
      nombre,
      preferencia,
      porDefecto = null,
      alActualizar = null,
      transformar = (v) => v
    ) {
      let cache;
      let listo = false;

      const leer = () => {
        switch (Services.prefs.getPrefType(preferencia)) {
          case PREF_BOOL:
            return Services.prefs.getBoolPref(preferencia);
          case PREF_INT:
            return Services.prefs.getIntPref(preferencia);
          case PREF_STRING:
            return Services.prefs.getStringPref(preferencia);
          default:
            return porDefecto;
        }
      };

      const observador = {
        observe() {
          const anterior = cache;
          cache = leer();
          if (alActualizar) {
            alActualizar(preferencia, anterior, cache);
          }
        },
      };

      Object.defineProperty(objeto, nombre, {
        configurable: true,
        enumerable: true,
        get() {
          if (!listo) {
            cache = leer();
            listo = true;
            Services.prefs.addObserver(preferencia, observador);
          }
          return transformar(cache);
        },
      });
    },

    // Declaración de getters perezosos: cadena = módulo, función = valor calculado,
    // {service} / {pref} como en Firefox.
    defineLazy(lazy, definicion, opciones) {
      const modulos = {};
      for (const [clave, valor] of Object.entries(definicion)) {
        if (typeof valor === "string") {
          modulos[clave] = valor;
        } else if (typeof valor === "function") {
          globalThis.ChromeUtils.defineLazyGetter(lazy, clave, valor);
        } else if ("service" in valor) {
          utils.defineLazyServiceGetter(lazy, clave, valor.service, valor.iid);
        } else if ("pref" in valor) {
          utils.defineLazyPreferenceGetter(lazy, clave, valor.pref, valor.default, valor.onUpdate, valor.transform);
        } else {
          throw new Error(`Unkown LazyDefinition for ${clave}`);
        }
      }
      globalThis.ChromeUtils.defineESModuleGetters(lazy, modulos, opciones);
      return lazy;
    },

    declareLazy(declaracion, opciones) {
      return utils.defineLazy({}, declaracion, opciones);
    },

    defineLazyServiceGetters(objeto, servicios) {
      for (const [nombre, [contrato, iid]] of Object.entries(servicios)) {
        utils.defineLazyServiceGetter(objeto, nombre, contrato, iid);
      }
    },

    // Perezoso como en Firefox: solo falla si alguien llega a usar el servicio.
    defineLazyServiceGetter(objeto, nombre, contrato) {
      Object.defineProperty(objeto, nombre, {
        configurable: true,
        enumerable: true,
        get() {
          throw new Error(`NS_ERROR_NOT_AVAILABLE: servicio sin emular ${contrato}`);
        },
      });
    },
  };
  return utils;
}
