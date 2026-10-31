window.__e = () => JSON.stringify(gBrowser.tabs.map(t => `${t.rustronId}:${t.getAttribute("label")}${t.hasAttribute("selected") ? "*" : ""}${t.hasAttribute("zen-empty-tab") ? "(vacia)" : ""}`));
window.__e()
//---
gBrowser.addTab("http://127.0.0.1:PUERTO_WEB/q.html"); "pedida"
//---
window.__e()
//---
gBrowser.selectedTab = gBrowser.tabs[0]; "seleccionada"
//---
window.__e()
//---
gBrowser.loadURI("http://127.0.0.1:PUERTO_WEB/q.html"); "navegando"
//---
window.__e()
//---
gBrowser.removeTab(gBrowser.tabs.find(t => t.rustronId == 2)); "cerrando"
//---
window.__e()
//---
(gBrowser.tabs[0].getAttribute("image") ?? "sin icono").slice(0, 22)
//---
window.__k = (key, extra = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })); window.__k("t", { ctrlKey: true }); "ctrl+t"
//---
gURLBar.getAttribute("zen-newtab")
//---
gBrowser.addTab("http://127.0.0.1:PUERTO_WEB/q.html"); "otra"
//---
String(gBrowser.tabs.filter((t) => t.rustronId != null).length)
//---
(() => { const t = gBrowser.tabs.filter((x) => x.rustronId != null)[1]; const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 10, button: 2 })); return String(document.querySelectorAll('menupopup[state="open"]').length); })()
//---
String(!!document.getElementById("rustron-contenido").style.backgroundImage)
//---
document.getElementById("context_closeTab").click(); "cerrar"
//---
[gBrowser.tabs.filter((t) => t.rustronId != null).length, document.querySelectorAll('menupopup[state="open"]').length].join(",")
//---
String(!!document.getElementById("rustron-contenido").style.backgroundImage)
