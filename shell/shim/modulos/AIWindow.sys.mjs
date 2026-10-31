// Las "ventanas de IA" de Firefox no existen en Rustron: ninguna ventana lo es y la función está desactivada.
// Lo que no sea una consulta de estado (launchWindow, createAITab, chatStore...) no existe a propósito.

export const AIWindow = {
  isOpeningAIWindow: () => false,
  isAIWindowActive: () => false,
  isAIWindowActiveAndEnabled: () => false,
  isAIWindowEnabled: () => false,
  isEnabled: false,
  isAIWindowNewTabPage: () => false,
};
