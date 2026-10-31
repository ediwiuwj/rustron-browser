// JSONFile: un objeto JSON respaldado por un archivo. La E/S real la pone Rust
// (puente de M2) mediante usarAlmacenamiento({ leer, escribir, leerSync }).
// La compresión (`compression: "lz4"`) es cosa del almacenamiento, no de este módulo.

import { DeferredTask } from "./DeferredTask.sys.mjs";

const RETRASO_GUARDADO_MS = 1500;

let almacenamiento = null;

// leer(ruta) -> Promise<string|null> (null si no existe); escribir(ruta, texto) -> Promise;
// leerSync(ruta) opcional, solo para ensureDataReady.
export function usarAlmacenamiento(nuevo) {
  almacenamiento = nuevo;
}

function disco() {
  if (!almacenamiento) {
    throw new Error("JSONFile: no hay almacenamiento configurado");
  }
  return almacenamiento;
}

export class JSONFile {
  path;
  #opciones;
  #datos = {};
  #cargado = false;
  #tarea;

  constructor(opciones) {
    this.path = opciones.path;
    this.#opciones = opciones;
    this.#tarea = new DeferredTask(() => this._save(), opciones.saveDelayMs ?? RETRASO_GUARDADO_MS);
  }

  get dataReady() {
    return this.#cargado;
  }

  get data() {
    if (!this.#cargado) {
      throw new Error("JSONFile: los datos aún no se han cargado");
    }
    return this.#datos;
  }

  set data(valor) {
    this.#cargado = true;
    this.#datos = valor;
  }

  #interpretar(texto) {
    let datos = {};
    if (texto != null) {
      try {
        datos = JSON.parse(texto);
      } catch {
        // Un archivo corrupto se trata como vacío; el siguiente guardado lo reemplaza.
        datos = {};
      }
    }
    const procesar = this.#opciones.dataPostProcessor;
    this.#datos = procesar ? (procesar.call(this, datos) ?? datos) : datos;
    this.#cargado = true;
  }

  async load() {
    this.#interpretar(await disco().leer(this.path));
  }

  ensureDataReady() {
    if (this.#cargado) {
      return;
    }
    const leerSync = disco().leerSync;
    if (!leerSync) {
      throw new Error("JSONFile: el almacenamiento no admite lectura síncrona");
    }
    this.#interpretar(leerSync.call(disco(), this.path));
  }

  saveSoon() {
    this.#tarea.arm();
  }

  async _save() {
    const texto = JSON.stringify(this.data);
    await disco().escribir(this.path, texto);
    if (this.#opciones.backupTo) {
      await disco().escribir(this.#opciones.backupTo, texto);
    }
  }

  async finalize() {
    await this.#tarea.finalize();
    if (this.#cargado) {
      await this._save();
    }
  }
}
