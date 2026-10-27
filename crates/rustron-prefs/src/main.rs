use std::fs;
use std::path::Path;
use std::process::ExitCode;

use rustron_prefs::{Ajustes, apply, listar, render};

const USO: &str = "uso:
  rustron-prefs listar
  rustron-prefs mostrar <config.toml>
  rustron-prefs aplicar <config.toml> <carpeta-del-perfil>";

fn main() -> ExitCode {
    let argumentos: Vec<String> = std::env::args().skip(1).collect();
    let resultado = match argumentos
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["listar"] => {
            print!("{}", listar());
            Ok(())
        }
        ["mostrar", config] => cargar(config).map(|a| print!("{}", render(&a))),
        ["aplicar", config, perfil] => cargar(config).and_then(|a| {
            let destino = apply(&a, Path::new(perfil))?;
            println!("user.js escrito en {}", destino.display());
            Ok(())
        }),
        _ => Err(USO.to_string()),
    };
    match resultado {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn cargar(ruta: &str) -> Result<Ajustes, String> {
    let texto = fs::read_to_string(ruta).map_err(|e| format!("No se pudo leer {ruta}: {e}"))?;
    Ajustes::parse(&texto)
}
