// Sustituye a AddonManager (extensiones, temas, diccionarios). Rustron no tiene extensiones: no hay ningún
// complemento instalado y buscar uno no encuentra nada. (El módulo real arrastra toda la infraestructura de
// extensiones de Firefox.)
export const AddonManager = {
  getAddonsByTypes: async () => [],
  getAddonByID: async () => null,
  getAllAddons: async () => [],
  getActiveAddons: async () => ({ addons: [], fullData: false }),
  addAddonListener() {},
  removeAddonListener() {},
  addManagerListener() {},
  removeManagerListener() {},
};
