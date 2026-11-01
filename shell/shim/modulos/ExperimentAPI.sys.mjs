// Nimbus (experimentos remotos) no existe en Rustron: toda característica está sin configurar,
// sin experimentos activos y con los valores por defecto de su manifiesto.

import { FeatureManifest } from "resource://nimbus/FeatureManifest.sys.mjs";
import { PREF_BOOL, PREF_INT, PREF_STRING } from "../prefs.js";

// El valor de una variable de una característica sin experimento: el de su preferencia de respaldo
// (`fallbackPref` del manifiesto real de Firefox) si tiene valor, o undefined.
function valorDePreferencia(variable) {
  const nombre = variable?.fallbackPref;
  const prefs = globalThis.Services?.prefs;
  if (!nombre || !prefs) {
    return undefined;
  }
  switch (prefs.getPrefType(nombre)) {
    case PREF_BOOL:
      return prefs.getBoolPref(nombre);
    case PREF_INT:
      return prefs.getIntPref(nombre);
    case PREF_STRING:
      return prefs.getStringPref(nombre);
    default:
      return undefined;
  }
}

function caracteristica(nombre) {
  const variables = FeatureManifest[nombre]?.variables ?? {};
  const delRespaldo = () => {
    const valores = {};
    for (const [clave, variable] of Object.entries(variables)) {
      const valor = valorDePreferencia(variable);
      if (valor !== undefined) {
        valores[clave] = valor;
      }
    }
    return valores;
  };
  return {
    onUpdate() {},
    offUpdate() {},
    // Con `defaultValues`, Nimbus devuelve esos valores con los de las preferencias de respaldo encima (no hay remotos).
    getAllVariables: (opciones) => ({ ...(opciones?.defaultValues ?? {}), ...delRespaldo() }),
    getVariable: (variable) => valorDePreferencia(variables[variable]),
    isEnabled: () => false,
    ready: async () => {},
    recordExposureEvent() {},
  };
}

export const NimbusFeatures = new Proxy({}, { get: (_, nombre) => (typeof nombre === "string" ? caracteristica(nombre) : undefined) });

export const ExperimentAPI = {
  ready: async () => {},
  getExperimentMetaData: () => null,
  getActiveBranch: () => null,
};
