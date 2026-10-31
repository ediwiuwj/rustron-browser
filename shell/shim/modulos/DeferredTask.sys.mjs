// DeferredTask: ejecuta una función una vez tras un retraso. Como en Firefox,
// armar una tarea ya armada no reinicia el plazo, y armarla mientras corre
// la vuelve a programar al terminar.

import { clearTimeout, setTimeout } from "./Timer.sys.mjs";

export class DeferredTask {
  #funcion;
  #retraso;
  #temporizador = null;
  #ejecucion = null;
  #rearmar = false;
  #finalizada = false;

  constructor(funcion, retrasoMs) {
    this.#funcion = funcion;
    this.#retraso = retrasoMs;
  }

  get isArmed() {
    return this.#temporizador !== null || this.#rearmar;
  }

  get isRunning() {
    return this.#ejecucion !== null;
  }

  arm() {
    if (this.#finalizada) {
      throw new Error("DeferredTask finalizada");
    }
    if (this.#ejecucion) {
      this.#rearmar = true;
      return;
    }
    if (this.#temporizador === null) {
      this.#temporizador = setTimeout(() => this.#disparar(), this.#retraso);
    }
  }

  disarm() {
    if (this.#temporizador !== null) {
      clearTimeout(this.#temporizador);
      this.#temporizador = null;
    }
    this.#rearmar = false;
  }

  // Ejecuta ya lo pendiente y no permite volver a armar la tarea.
  async finalize() {
    this.#finalizada = true;
    if (this.#temporizador !== null) {
      this.disarm();
      await this.#disparar();
    } else if (this.#ejecucion) {
      await this.#ejecucion;
      if (this.#rearmar) {
        this.#rearmar = false;
        await this.#disparar();
      }
    }
  }

  #disparar() {
    this.#temporizador = null;
    this.#ejecucion = (async () => {
      try {
        await this.#funcion();
      } finally {
        this.#ejecucion = null;
        if (this.#rearmar && !this.#finalizada) {
          this.#rearmar = false;
          this.arm();
        }
      }
    })();
    return this.#ejecucion;
  }
}
