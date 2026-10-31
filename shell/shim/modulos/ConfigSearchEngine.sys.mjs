// Sustituye a ConfigSearchEngine: en Firefox es un motor de búsqueda definido por la configuración remota
// (Remote Settings). Rustron no tiene configuración remota, así que ningún motor es de esa clase; solo
// existe para que la barra de direcciones pueda hacer `engine instanceof ConfigSearchEngine` (y lo mismo
// con AppProvidedConfigEngine, que este módulo también exporta).
export class ConfigSearchEngine {}
export class AppProvidedConfigEngine {}
