// Sustituye a CustomizableUI (barras de herramientas personalizables de Firefox): en Rustron las barras
// son fijas, así que no hay paleta, ni personalización, ni colocaciones guardadas. Lo único que hace es
// lo que Zen necesita de él al abrir la ventana: que ZenCustomizableUI registre sus áreas y monte la
// barra lateral (separador, botones superiores, botón de crear). Lo demás de la API no existe a propósito.
//
// Pendiente: el botón de la biblioteca (zen-library-button, un widget que se crea con
// createBuiltinWidget) necesita DownloadsCommon con datos reales; sin descargas no se instancia.

const areas = new Map();
const widgets = new Map();

export const CustomizableUI = {
  AREA_ADDONS: "addon-bar",
  AREA_TABSTRIP: "TabsToolbar",
  AREA_NAVBAR: "nav-bar",
  AREA_BOOKMARKS: "PersonalToolbar",
  TYPE_TOOLBAR: "toolbar",
  get areas() {
    return [...areas.keys()];
  },
  addListener() {},
  removeListener() {},
  getPlacementOfWidget: () => null,
  addWidgetToArea() {},
  getAreaType: (nombre) => areas.get(nombre)?.type ?? null,
  // Las llama ZenCustomizableUI.startup(this): solo se anotan.
  registerArea(nombre, propiedades) {
    areas.set(nombre, propiedades);
  },
  createBuiltinWidget(definicion) {
    widgets.set(definicion.id, definicion);
  },
  registerToolbarNode() {},

  // Equivale a lo que CustomizableUIInternal hace al iniciarse y en handleNewBrowserWindow.
  iniciarVentana(ventana) {
    const { ZenCustomizableUI } = ventana.ChromeUtils.importESModule("resource:///modules/ZenCustomizableUI.sys.mjs");
    ZenCustomizableUI.startup(this);
    ZenCustomizableUI.init(ventana);
    ZenCustomizableUI.registerToolbarNodes(ventana);
  },
};
