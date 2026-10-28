// XPCOMUtils: solo lo que usa Zen (defineLazyPreferenceGetter, 17 usos).

import { PREF_BOOL, PREF_INT, PREF_STRING } from "./prefs.js";

export function crearXPCOMUtils(Services) {
  return {
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

    defineLazyServiceGetter() {
      throw new Error("XPCOMUtils.defineLazyServiceGetter: servicio no implementado todavía");
    },
  };
}
