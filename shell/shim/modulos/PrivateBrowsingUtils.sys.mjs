// PrivateBrowsingUtils: Rustron aún no tiene ventanas privadas; una ventana lo es
// solo si la interfaz lo declara con `privado: true`.

export const PrivateBrowsingUtils = {
  permanentPrivateBrowsing: false,

  isWindowPrivate: (ventana) => ventana?.privado === true,

  isBrowserPrivate: (navegador) => navegador?.ownerGlobal?.privado === true,
};
