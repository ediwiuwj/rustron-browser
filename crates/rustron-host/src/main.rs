//! Host de native messaging: la extensión de Zen le habla por stdin/stdout.
//!
//! Protocolo de Firefox: cada mensaje es un entero de 32 bits en orden nativo
//! (little-endian en x86_64) seguido de JSON de esa longitud.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use rustron_prefs::{Ajustes, CATALOGO, Tipo, apply};
use serde_json::{Map, Value, json};

const TAMANO_MAXIMO: u32 = 1024 * 1024;

fn main() -> io::Result<()> {
    let ruta = ruta_config();
    let mut entrada = io::stdin().lock();
    let mut salida = io::stdout().lock();
    while let Some(mensaje) = leer_mensaje(&mut entrada)? {
        let respuesta = manejar(&mensaje, &ruta);
        escribir_mensaje(&mut salida, &respuesta)?;
    }
    Ok(())
}

fn ruta_config() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("rustron").join("zen.toml")
}

fn leer_mensaje(entrada: &mut impl Read) -> io::Result<Option<Value>> {
    let mut longitud = [0u8; 4];
    match entrada.read_exact(&mut longitud) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let longitud = u32::from_ne_bytes(longitud);
    if longitud > TAMANO_MAXIMO {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "mensaje demasiado grande",
        ));
    }
    let mut cuerpo = vec![0u8; longitud as usize];
    entrada.read_exact(&mut cuerpo)?;
    serde_json::from_slice(&cuerpo)
        .map(Some)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn escribir_mensaje(salida: &mut impl Write, valor: &Value) -> io::Result<()> {
    let cuerpo = serde_json::to_vec(valor).map_err(io::Error::other)?;
    salida.write_all(&(cuerpo.len() as u32).to_ne_bytes())?;
    salida.write_all(&cuerpo)?;
    salida.flush()
}

fn manejar(mensaje: &Value, ruta_config: &Path) -> Value {
    let comando = mensaje.get("cmd").and_then(Value::as_str).unwrap_or("");
    match comando {
        "catalog" => catalogo(),
        "get" => obtener(ruta_config),
        "set" => {
            let texto = mensaje.get("config").and_then(Value::as_str).unwrap_or("");
            guardar(texto, ruta_config)
        }
        "apply" => {
            let Some(perfil) = mensaje.get("perfil").and_then(Value::as_str) else {
                return error("falta la carpeta del perfil");
            };
            aplicar(perfil, ruta_config)
        }
        otro => error(&format!("comando desconocido: '{otro}'")),
    }
}

fn error(texto: &str) -> Value {
    json!({ "ok": false, "error": texto })
}

fn catalogo() -> Value {
    let ajustes: Vec<Value> = CATALOGO
        .iter()
        .map(|a| {
            json!({
                "clave": a.clave,
                "pref": a.pref,
                "tipo": nombre_tipo(a.tipo),
                "por_defecto": a.por_defecto,
                "descripcion": a.descripcion,
            })
        })
        .collect();
    json!({ "ok": true, "ajustes": ajustes })
}

fn nombre_tipo(tipo: Tipo) -> &'static str {
    match tipo {
        Tipo::Bool => "bool",
        Tipo::Int => "int",
        Tipo::Str => "texto",
    }
}

fn obtener(ruta_config: &Path) -> Value {
    let texto = match fs::read_to_string(ruta_config) {
        Ok(t) => t,
        Err(e) if e.kind() == io::ErrorKind::NotFound => String::new(),
        Err(e) => return error(&format!("no se pudo leer la configuración: {e}")),
    };
    match texto.parse::<toml::Table>() {
        Ok(tabla) => json!({ "ok": true, "valores": aplanar(&tabla) }),
        Err(e) => error(&format!("configuración inválida: {e}")),
    }
}

fn aplanar(tabla: &toml::Table) -> Map<String, Value> {
    let mut mapa = Map::new();
    for (seccion, contenido) in tabla {
        if let Some(sub) = contenido.as_table() {
            for (clave, valor) in sub {
                if let Ok(json_valor) = serde_json::to_value(valor) {
                    mapa.insert(format!("{seccion}.{clave}"), json_valor);
                }
            }
        }
    }
    mapa
}

fn guardar(texto: &str, ruta_config: &Path) -> Value {
    if let Err(e) = Ajustes::parse(texto) {
        return error(&e);
    }
    let Some(carpeta) = ruta_config.parent() else {
        return error("ruta de configuración inválida");
    };
    if let Err(e) = fs::create_dir_all(carpeta) {
        return error(&format!("no se pudo crear {}: {e}", carpeta.display()));
    }
    match fs::write(ruta_config, texto) {
        Ok(()) => json!({ "ok": true, "ruta": ruta_config.display().to_string() }),
        Err(e) => error(&format!("no se pudo guardar la configuración: {e}")),
    }
}

fn aplicar(perfil: &str, ruta_config: &Path) -> Value {
    let texto = match fs::read_to_string(ruta_config) {
        Ok(t) => t,
        Err(e) => return error(&format!("no hay configuración guardada: {e}")),
    };
    let ajustes = match Ajustes::parse(&texto) {
        Ok(a) => a,
        Err(e) => return error(&e),
    };
    match apply(&ajustes, Path::new(perfil)) {
        Ok(destino) => json!({ "ok": true, "destino": destino.display().to_string() }),
        Err(e) => error(&e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporal(nombre: &str) -> PathBuf {
        let ruta =
            std::env::temp_dir().join(format!("rustron-host-{nombre}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&ruta);
        fs::create_dir_all(&ruta).unwrap();
        ruta
    }

    #[test]
    fn framing_round_trip() {
        let mut bytes = Vec::new();
        escribir_mensaje(&mut bytes, &json!({ "cmd": "catalog" })).unwrap();
        let leido = leer_mensaje(&mut bytes.as_slice()).unwrap().unwrap();
        assert_eq!(leido, json!({ "cmd": "catalog" }));
    }

    #[test]
    fn eof_ends_the_loop() {
        let vacio: &[u8] = &[];
        assert!(leer_mensaje(&mut &vacio[..]).unwrap().is_none());
    }

    #[test]
    fn catalog_lists_every_setting() {
        let respuesta = catalogo();
        let ajustes = respuesta["ajustes"].as_array().unwrap();
        assert_eq!(ajustes.len(), CATALOGO.len());
        assert!(
            ajustes
                .iter()
                .any(|a| a["clave"] == "tabs.vertical" && a["tipo"] == "bool")
        );
    }

    #[test]
    fn get_without_file_returns_empty_values() {
        let ruta = temporal("get").join("zen.toml");
        let respuesta = obtener(&ruta);
        assert_eq!(respuesta["ok"], true);
        assert!(respuesta["valores"].as_object().unwrap().is_empty());
    }

    #[test]
    fn set_validates_before_writing() {
        let carpeta = temporal("set");
        let ruta = carpeta.join("zen.toml");
        let malo = guardar("[tabs]\nfoo = 1\n", &ruta);
        assert_eq!(malo["ok"], false);
        assert!(!ruta.exists());

        let bueno = guardar("[tabs]\nvertical = false\n", &ruta);
        assert_eq!(bueno["ok"], true);
        let leido = obtener(&ruta);
        assert_eq!(leido["valores"]["tabs.vertical"], false);
        fs::remove_dir_all(&carpeta).unwrap();
    }

    #[test]
    fn apply_writes_user_js_in_given_profile() {
        let carpeta = temporal("apply");
        let ruta = carpeta.join("zen.toml");
        guardar("[tabs]\nvertical = true\n", &ruta);
        let perfil = temporal("perfil");
        let respuesta = manejar(
            &json!({ "cmd": "apply", "perfil": perfil.display().to_string() }),
            &ruta,
        );
        assert_eq!(respuesta["ok"], true, "{respuesta}");
        assert!(perfil.join("user.js").exists());
        fs::remove_dir_all(&carpeta).unwrap();
        fs::remove_dir_all(&perfil).unwrap();
    }

    #[test]
    fn unknown_command_is_an_error() {
        let respuesta = manejar(&json!({ "cmd": "borrar_todo" }), Path::new("/nope"));
        assert_eq!(respuesta["ok"], false);
    }
}
