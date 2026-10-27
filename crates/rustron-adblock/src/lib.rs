//! Convierte listas de filtros ABP (EasyList, EasyPrivacy...) a reglas de contenido
//! de WebKit, usando el motor `adblock-rust` de Brave.
//!
//! WebKit limita cuántas reglas acepta por filtro, así que el resultado se devuelve
//! en bloques de JSON. Cada bloque se compila como un filtro independiente.

use adblock::lists::{FilterSet, ParseOptions};

/// Reglas por bloque. Un filtro de WebKit grande puede fallar al compilarse.
pub const REGLAS_POR_BLOQUE: usize = 20_000;

/// Compila una o más listas ABP a bloques JSON de reglas de contenido de WebKit.
pub fn compilar<S: AsRef<str>>(listas: &[S]) -> Result<Vec<String>, String> {
    let mut conjunto = FilterSet::new(true);
    for lista in listas {
        conjunto.add_filter_list(lista.as_ref().to_string(), ParseOptions::default());
    }
    let (reglas, _) = conjunto
        .into_content_blocking()
        .map_err(|()| "no se pudieron convertir las reglas".to_string())?;
    let bloques: Vec<String> = reglas
        .chunks(REGLAS_POR_BLOQUE)
        .map(|bloque| serde_json::to_string(bloque).map_err(|e| e.to_string()))
        .collect::<Result<_, _>>()?;
    if bloques.is_empty() {
        return Ok(vec!["[]".to_string()]);
    }
    Ok(bloques)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_rule_becomes_webkit_rule() {
        let bloques = compilar(&["||ads.example.com^\n"]).unwrap();
        assert_eq!(bloques.len(), 1);
        let json: serde_json::Value = serde_json::from_str(&bloques[0]).unwrap();
        let reglas = json.as_array().unwrap();
        assert!(!reglas.is_empty());
        assert!(reglas.iter().any(|r| {
            r["action"]["type"] == "block"
                && r["trigger"]["url-filter"]
                    .as_str()
                    .unwrap_or("")
                    .contains("example")
        }));
    }

    #[test]
    fn comments_and_empty_lists_produce_no_rules() {
        let bloques = compilar(&["! Título de la lista\n[Adblock Plus 2.0]\n"]).unwrap();
        let json: serde_json::Value = serde_json::from_str(&bloques[0]).unwrap();
        assert!(json.as_array().unwrap().is_empty());
    }

    #[test]
    fn large_lists_are_split_into_blocks() {
        let filas: Vec<String> = (0..(REGLAS_POR_BLOQUE + 5))
            .map(|i| format!("||anuncio{i}.example.org^\n"))
            .collect();
        let bloques = compilar(&[filas.concat()]).unwrap();
        assert!(bloques.len() >= 2);
    }
}
