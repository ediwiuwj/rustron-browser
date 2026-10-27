const HOST = "com.rustron.host";
const enviar = (mensaje) => browser.runtime.sendNativeMessage(HOST, mensaje);

const campos = new Map();
let catalogo = [];

function aTexto(valor) {
  return typeof valor === "string" ? valor : String(valor);
}

function mostrar(texto, error = false) {
  const estado = document.getElementById("estado");
  estado.textContent = texto;
  estado.style.color = error ? "#f38ba8" : "";
}

function crearFila(ajuste, valorActual) {
  const fila = document.createElement("div");
  fila.className = "fila";
  const etiqueta = document.createElement("div");
  const titulo = document.createElement("span");
  titulo.textContent = ajuste.descripcion;
  const detalle = document.createElement("small");
  detalle.textContent = `${ajuste.pref} · por defecto: ${ajuste.por_defecto}`;
  etiqueta.append(titulo, detalle);

  let input;
  if (ajuste.tipo === "bool") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = valorActual === undefined ? ajuste.por_defecto === "true" : valorActual === true;
  } else if (ajuste.tipo === "int") {
    input = document.createElement("input");
    input.type = "number";
    input.step = "1";
    input.value = valorActual === undefined ? ajuste.por_defecto : aTexto(valorActual);
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.value = valorActual === undefined ? ajuste.por_defecto : aTexto(valorActual);
  }
  campos.set(ajuste.clave, input);
  fila.append(etiqueta, input);
  return fila;
}

function pintar(valores) {
  const contenedor = document.getElementById("secciones");
  contenedor.replaceChildren();
  const grupos = new Map();
  for (const ajuste of catalogo) {
    const seccion = ajuste.clave.split(".")[0];
    if (!grupos.has(seccion)) grupos.set(seccion, []);
    grupos.get(seccion).push(ajuste);
  }
  for (const [seccion, ajustes] of grupos) {
    const h2 = document.createElement("h2");
    h2.textContent = seccion;
    contenedor.append(h2);
    for (const ajuste of ajustes) {
      contenedor.append(crearFila(ajuste, valores[ajuste.clave]));
    }
  }
}

function valorDe(ajuste, input) {
  if (ajuste.tipo === "bool") return input.checked;
  if (ajuste.tipo === "int") return Number.parseInt(input.value, 10);
  return input.value;
}

function construirToml() {
  const secciones = new Map();
  for (const ajuste of catalogo) {
    const input = campos.get(ajuste.clave);
    const valor = valorDe(ajuste, input);
    const porDefecto = ajuste.tipo === "bool"
      ? ajuste.por_defecto === "true"
      : ajuste.tipo === "int" ? Number.parseInt(ajuste.por_defecto, 10) : ajuste.por_defecto;
    if (valor === porDefecto) continue;
    const [seccion, clave] = ajuste.clave.split(".");
    const linea = `${clave} = ${typeof valor === "string" ? JSON.stringify(valor) : valor}`;
    if (!secciones.has(seccion)) secciones.set(seccion, []);
    secciones.get(seccion).push(linea);
  }
  let texto = "";
  for (const [seccion, lineas] of secciones) {
    texto += `[${seccion}]\n${lineas.join("\n")}\n\n`;
  }
  return texto;
}

async function guardar() {
  const respuesta = await enviar({ cmd: "set", config: construirToml() });
  if (!respuesta.ok) throw new Error(respuesta.error);
  return respuesta;
}

async function accionGuardar() {
  try {
    await guardar();
    mostrar("Guardado. Reinicia Zen para aplicar los cambios.");
  } catch (error) {
    mostrar(`No se guardó: ${error.message}`, true);
  }
}

async function accionAplicar() {
  const perfil = document.getElementById("perfil").value.trim();
  if (!perfil) {
    mostrar("Escribe la carpeta del perfil antes de aplicar.", true);
    return;
  }
  try {
    await guardar();
    const respuesta = await enviar({ cmd: "apply", perfil });
    if (!respuesta.ok) throw new Error(respuesta.error);
    mostrar(`Aplicado en ${respuesta.destino}. Reinicia Zen para verlo.`);
  } catch (error) {
    mostrar(`No se aplicó: ${error.message}`, true);
  }
}

async function iniciar() {
  try {
    const lista = await enviar({ cmd: "catalog" });
    const actual = await enviar({ cmd: "get" });
    if (!lista.ok) throw new Error(lista.error);
    if (!actual.ok) throw new Error(actual.error);
    catalogo = lista.ajustes;
    pintar(actual.valores);
    mostrar("");
  } catch (error) {
    mostrar(`No se pudo conectar con el backend Rust: ${error.message}`, true);
  }
}

document.getElementById("guardar").addEventListener("click", accionGuardar);
document.getElementById("aplicar").addEventListener("click", accionAplicar);
iniciar();
