//! Servicios que Rust presta a la UI mediante peticiones.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde_json::{Value, json};

/// Lectura y escritura de archivos confinadas a una carpeta (el perfil). La UI es
/// código web: nunca debe poder salir de su carpeta, ni con `..` ni con rutas absolutas.
pub struct Almacen {
    raiz: PathBuf,
}

impl Almacen {
    pub fn new(raiz: impl Into<PathBuf>) -> Self {
        Self { raiz: raiz.into() }
    }

    /// Atiende una petición `leer` o `escribir`.
    pub fn atender(&self, metodo: &str, args: &Value) -> Result<Value, String> {
        match metodo {
            "leer" => self.leer(texto(args, "ruta")?),
            "escribir" => self.escribir(texto(args, "ruta")?, texto(args, "texto")?),
            otro => Err(format!("método desconocido: {otro}")),
        }
    }

    fn resolver(&self, ruta: &str) -> Result<PathBuf, String> {
        let pedida = Path::new(ruta);
        let relativa = pedida.strip_prefix(&self.raiz).unwrap_or(pedida);
        let mut destino = self.raiz.clone();
        for parte in relativa.components() {
            match parte {
                Component::Normal(p) => destino.push(p),
                Component::CurDir => {}
                _ => return Err(format!("ruta fuera del perfil: {ruta}")),
            }
        }
        Ok(destino)
    }

    fn leer(&self, ruta: &str) -> Result<Value, String> {
        match fs::read_to_string(self.resolver(ruta)?) {
            Ok(contenido) => Ok(Value::String(contenido)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Escribe a un archivo temporal y lo renombra, para no dejar JSON a medias.
    fn escribir(&self, ruta: &str, contenido: &str) -> Result<Value, String> {
        let destino = self.resolver(ruta)?;
        if let Some(carpeta) = destino.parent() {
            fs::create_dir_all(carpeta).map_err(|e| e.to_string())?;
        }
        let mut temporal = destino.clone().into_os_string();
        temporal.push(".tmp");
        fs::write(&temporal, contenido).map_err(|e| e.to_string())?;
        fs::rename(&temporal, &destino).map_err(|e| e.to_string())?;
        Ok(json!(null))
    }
}

fn texto<'a>(args: &'a Value, campo: &str) -> Result<&'a str, String> {
    args.get(campo)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("falta el argumento de texto `{campo}`"))
}
