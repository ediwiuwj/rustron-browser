// Sustituye al Tabbrowser de Firefox (11 500 líneas atadas a <browser> y al docShell).
// Zen solo le pide los predicados estáticos, las preferencias y closingTabsEnum.
// El gBrowser real de Rustron está en shim/gbrowser.js.

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

export class Tabbrowser {
  static prefs = XPCOMUtils.declareLazy({
    showPidAndActiveness: { pref: "browser.tabs.tooltipsShowPidAndActiveness", default: false },
    tabGroupsEnabled: { pref: "browser.tabs.groups.enabled", default: false },
  });

  static closingTabsEnum = { ALL: 0, OTHER: 1, TO_START: 2, TO_END: 3, MULTI_SELECTED: 4, DUPLICATES: 6, ALL_DUPLICATES: 7 };

  static isTab(el) {
    return !!(el?.tagName == "tab");
  }
  static isTabGroup(el) {
    return !!(el?.tagName == "tab-group" || el?.tagName == "zen-folder");
  }
  static isTabGroupLabel(el) {
    return !!el?.classList?.contains("tab-group-label");
  }
  static isSplitViewWrapper(el) {
    return !!(el?.tagName == "tab-split-view-wrapper");
  }
}
