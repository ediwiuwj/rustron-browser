// Sustituye a ASRouter (el sistema de mensajes y promociones de Mozilla: sugerencias, anuncios en la interfaz).
// Rustron no tiene mensajes remotos: avisarle de un suceso (una búsqueda, por ejemplo) no muestra nada.
export const ASRouter = {
  sendTriggerMessage: async () => null,
  addListener() {},
  removeListener() {},
};
