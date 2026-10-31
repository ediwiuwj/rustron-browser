// Nimbus (experimentos remotos) no existe en Rustron: toda característica está sin configurar,
// sin variables y sin experimentos activos.

const caracteristica = {
  onUpdate() {},
  offUpdate() {},
  getAllVariables: () => ({}),
  getVariable: () => undefined,
  isEnabled: () => false,
  ready: async () => {},
  recordExposureEvent() {},
};

export const NimbusFeatures = new Proxy({}, { get: (_, nombre) => (typeof nombre === "string" ? caracteristica : undefined) });

export const ExperimentAPI = {
  ready: async () => {},
  getExperimentMetaData: () => null,
  getActiveBranch: () => null,
};
