// Nimbus (experimentos remotos) no existe en Rustron: toda característica está sin configurar,
// sin experimentos activos y con los valores por defecto de su manifiesto.

// Variables del manifiesto de cada característica que el código de Firefox lee aunque no haya experimento.
// En Firefox salen de FeatureManifest.yaml; aquí solo las que se han ido necesitando.
const MANIFIESTO = {
  urlbar: { quickSuggestOnlineAvailable: false },
};

function caracteristica(nombre) {
  const manifiesto = MANIFIESTO[nombre] ?? {};
  return {
    onUpdate() {},
    offUpdate() {},
    // Con `defaultValues`, Nimbus devuelve esos valores mezclados con los del manifiesto y los remotos (no hay).
    getAllVariables: (opciones) => ({ ...manifiesto, ...(opciones?.defaultValues ?? {}) }),
    getVariable: (variable) => manifiesto[variable],
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
