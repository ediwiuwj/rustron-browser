// Sustituye a CustomizableUI (barras de herramientas personalizables de Firefox): en Rustron las barras
// son fijas, así que no hay widgets, ni colocaciones, ni áreas que reconstruir. `zenInternalCU` y el resto
// de la API real no existen a propósito: Zen lo usa para recolocar la barra de pestañas (ZenVerticalTabsManager).

export const CustomizableUI = {
  AREA_ADDONS: "addon-bar",
  AREA_TABSTRIP: "TabsToolbar",
  AREA_NAVBAR: "nav-bar",
  AREA_BOOKMARKS: "PersonalToolbar",
  addListener() {},
  removeListener() {},
  getPlacementOfWidget: () => null,
  addWidgetToArea() {},
};
