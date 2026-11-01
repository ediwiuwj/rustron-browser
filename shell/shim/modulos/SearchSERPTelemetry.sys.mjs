// Sustituye a SearchSERPTelemetry (telemetría de las páginas de resultados de los buscadores). Rustron no envía
// telemetría: anotar de dónde viene una búsqueda no hace nada.
export const SearchSERPTelemetry = {
  recordBrowserSource() {},
  recordBrowserNewtabSession() {},
  init() {},
};
