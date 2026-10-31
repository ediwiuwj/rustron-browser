// XPCOMUtils como módulo. Necesita `Services`, que el arranque define antes de importar nada.

import { crearXPCOMUtils } from "../xpcom-utils.js";

export const XPCOMUtils = crearXPCOMUtils(globalThis.Services);
