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
  // Las constantes, tal como las define Firefox: el código real compara contra ellas, y una que falte
  // (`undefined == undefined`) hace que cualquier cosa "coincida" (la barra de direcciones se creía siempre
  // dentro del panel de desbordamiento y no lanzaba ninguna consulta).
  AREA_NAVBAR: "nav-bar",
  AREA_MENUBAR: "toolbar-menubar",
  AREA_TABSTRIP: "TabsToolbar",
  AREA_VERTICAL_TABSTRIP: "vertical-tabs",
  AREA_BOOKMARKS: "PersonalToolbar",
  AREA_FIXED_OVERFLOW_PANEL: "widget-overflow-fixed-list",
  AREA_ADDONS: "unified-extensions-area",
  AREA_NO_AREA: "customization-palette",
  TYPE_PANEL: "panel",
  TYPE_TOOLBAR: "toolbar",
  PROVIDER_XUL: "xul",
  PROVIDER_API: "api",
  PROVIDER_SPECIAL: "special",
  SOURCE_BUILTIN: "builtin",
  SOURCE_EXTERNAL: "external",
  REASON_WINDOW_CLOSED: "window-closed",
  REASON_AREA_UNREGISTERED: "area-unregistered",
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
    // Como al construir las áreas: cada widget de una barra lleva `cui-areatype`; ZenVerticalTabsManager
    // lo usa para saber qué botones de la barra de navegación mover a la barra superior de la barra lateral.
    const documento = ventana.document;
    for (const id of ["toolbar-menubar", "TabsToolbar", "nav-bar", "PersonalToolbar", "zen-sidebar-top-buttons", "zen-sidebar-foot-buttons"]) {
      const barra = documento.getElementById(id);
      const destino = documento.getElementById(barra?.getAttribute("customizationtarget")) ?? barra;
      for (const widget of destino?.children ?? []) {
        if (!widget.hasAttribute("skipintoolbarset") && !widget.hasAttribute("cui-areatype")) {
          widget.setAttribute("cui-areatype", "toolbar");
        }
      }
    }
  },
};
