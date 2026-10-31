// Timer.sys.mjs: en Firefox son funciones del módulo; aquí, las del entorno.
// Se llaman a través de globalThis para poder simular el tiempo en las pruebas.

export const setTimeout = (...args) => globalThis.setTimeout(...args);
export const clearTimeout = (...args) => globalThis.clearTimeout(...args);
export const setInterval = (...args) => globalThis.setInterval(...args);
export const clearInterval = (...args) => globalThis.clearInterval(...args);
