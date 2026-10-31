// Sustituye a webrtcUI de Firefox (indicadores y permisos de cámara, micrófono y pantalla compartida).
// Rustron aún no tiene WebRTC con permisos: ninguna pestaña comparte nada.

export const webrtcUI = {
  browserHasStreams: () => false,
  showSharingDoorhanger() {},
  get activeStreams() {
    return [];
  },
};
