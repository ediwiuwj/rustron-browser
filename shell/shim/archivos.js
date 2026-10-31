// PathUtils e IOUtils: lo que Zen usa de ellos. IOUtils no toca el disco por sí mismo: usa un
// almacén inyectado ({leer, escribir, existe, borrar}) que en la app real es el del puente
// (confinado al perfil). Sin almacén, guarda en memoria.

export function crearPathUtils(perfil = "/profile") {
  const unir = (...partes) =>
    partes
      .join("/")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || "/";
  return {
    profileDir: perfil,
    localProfileDir: perfil,
    join: unir,
    filename: (ruta) => ruta.split("/").pop(),
    parent: (ruta) => ruta.split("/").slice(0, -1).join("/") || "/",
  };
}

export function almacenEnMemoria() {
  const datos = new Map();
  return {
    leer: async (ruta) => datos.get(ruta) ?? null,
    escribir: async (ruta, texto) => void datos.set(ruta, texto),
    existe: async (ruta) => datos.has(ruta),
    borrar: async (ruta) => void datos.delete(ruta),
  };
}

function noExiste(ruta) {
  return Object.assign(new Error(`NotFoundError: ${ruta}`), { name: "NotFoundError" });
}

export function crearIOUtils(almacen = almacenEnMemoria()) {
  const leer = async (ruta) => {
    const texto = await almacen.leer(ruta);
    if (texto === null || texto === undefined) {
      throw noExiste(ruta);
    }
    return texto;
  };
  return {
    readUTF8: leer,
    readJSON: async (ruta) => JSON.parse(await leer(ruta)),
    write: async (ruta, datos) => {
      const texto = typeof datos === "string" ? datos : new TextDecoder().decode(datos);
      await almacen.escribir(ruta, texto);
      return texto.length;
    },
    writeUTF8: async (ruta, texto) => (await almacen.escribir(ruta, texto), texto.length),
    writeJSON: async (ruta, valor) => {
      const texto = JSON.stringify(valor);
      await almacen.escribir(ruta, texto);
      return texto.length;
    },
    exists: (ruta) => almacen.existe(ruta),
    remove: (ruta) => almacen.borrar(ruta),
    makeDirectory: async () => {},
  };
}
