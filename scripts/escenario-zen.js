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
