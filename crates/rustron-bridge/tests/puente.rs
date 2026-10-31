use rustron_bridge::{Almacen, Peticion, Puente};
use rustron_core::{Browser, Effect, EngineEvent, TabId};
use serde_json::{Value, json};

fn tipos(mensajes: &[String]) -> Vec<String> {
    mensajes
        .iter()
        .map(|m| {
            let v: Value = serde_json::from_str(m).unwrap();
            v["tipo"].as_str().unwrap().to_string()
        })
        .collect()
}

fn json_de(mensaje: &str) -> Value {
    serde_json::from_str(mensaje).unwrap()
}

fn accion(nombre: &str, resto: Value) -> String {
    let mut obj = resto.as_object().cloned().unwrap_or_default();
    obj.insert("nombre".into(), nombre.into());
    json!({ "tipo": "accion", "accion": obj }).to_string()
}

#[test]
fn listo_responde_con_la_instantanea_completa() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    let salida = puente.orden(&mut nav, r#"{"tipo":"listo"}"#).unwrap();
    assert_eq!(tipos(&salida.mensajes), ["instantanea"]);
    let estado = &json_de(&salida.mensajes[0])["estado"];
    assert_eq!(estado["espacios"][0]["nombre"], "Space");
    assert_eq!(estado["barraVisible"], true);
    assert_eq!(estado["pestanaActiva"], Value::Null);
}

#[test]
fn nueva_pestana_emite_creada_espacios_y_activada() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    let salida = puente
        .orden(
            &mut nav,
            &accion("nueva-pestana", json!({ "uri": "https://a.com" })),
        )
        .unwrap();
    assert_eq!(
        tipos(&salida.mensajes),
        ["pestana-creada", "espacios", "pestana-activada"]
    );
    let creada = json_de(&salida.mensajes[0]);
    assert_eq!(creada["pestana"]["uri"], "https://a.com");
    assert_eq!(creada["pestana"]["espacio"], 1);
    assert_eq!(json_de(&salida.mensajes[2])["id"], creada["pestana"]["id"]);
}

#[test]
fn navegar_devuelve_el_efecto_y_marca_la_pestana_cargando() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    puente
        .orden(&mut nav, &accion("nueva-pestana", json!({})))
        .unwrap();
    let id = nav.active_tab.unwrap();

    let salida = puente
        .orden(
            &mut nav,
            &accion(
                "navegar",
                json!({ "pestana": id.0, "texto": "rust-lang.org" }),
            ),
        )
        .unwrap();
    assert_eq!(
        salida.efectos,
        [Effect::Navigate {
            tab: id,
            uri: "https://rust-lang.org".into()
        }]
    );
    assert_eq!(tipos(&salida.mensajes), ["pestana-actualizada"]);
    let p = &json_de(&salida.mensajes[0])["pestana"];
    assert_eq!(p["cargando"], true);
    assert_eq!(p["uri"], "https://rust-lang.org");
}

#[test]
fn los_eventos_del_motor_llegan_a_la_ui() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    puente
        .orden(&mut nav, &accion("nueva-pestana", json!({})))
        .unwrap();
    let id = nav.active_tab.unwrap();

    let salida = puente.evento_motor(
        &mut nav,
        EngineEvent::TitleChanged {
            tab: id,
            title: "Hola".into(),
        },
    );
    assert_eq!(tipos(&salida.mensajes), ["pestana-actualizada"]);
    assert_eq!(json_de(&salida.mensajes[0])["pestana"]["titulo"], "Hola");

    // Sin cambio real no se emite nada.
    let repetida = puente.evento_motor(
        &mut nav,
        EngineEvent::TitleChanged {
            tab: id,
            title: "Hola".into(),
        },
    );
    assert!(repetida.mensajes.is_empty());

    let cierre = puente.evento_motor(&mut nav, EngineEvent::Closed(id));
    assert_eq!(
        tipos(&cierre.mensajes),
        ["pestana-cerrada", "espacios", "pestana-activada"]
    );
}

#[test]
fn el_icono_de_la_pestana_llega_a_la_ui() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    puente
        .orden(&mut nav, &accion("nueva-pestana", json!({})))
        .unwrap();
    let id = nav.active_tab.unwrap();

    let salida = puente.evento_motor(
        &mut nav,
        EngineEvent::FaviconChanged {
            tab: id,
            icon: Some("data:image/png;base64,AAAA".into()),
        },
    );
    assert_eq!(tipos(&salida.mensajes), ["pestana-actualizada"]);
    assert_eq!(
        json_de(&salida.mensajes[0])["pestana"]["icono"],
        "data:image/png;base64,AAAA"
    );

    let sin_icono = puente.evento_motor(
        &mut nav,
        EngineEvent::FaviconChanged {
            tab: id,
            icon: None,
        },
    );
    assert!(json_de(&sin_icono.mensajes[0])["pestana"]["icono"].is_null());
}

#[test]
fn cerrar_pestana_pide_liberar_la_vista() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    puente
        .orden(&mut nav, &accion("nueva-pestana", json!({})))
        .unwrap();
    let id = nav.active_tab.unwrap();
    let salida = puente
        .orden(
            &mut nav,
            &accion("cerrar-pestana", json!({ "pestana": id.0 })),
        )
        .unwrap();
    assert!(salida.efectos.contains(&Effect::Release(id)));
    assert_eq!(json_de(&salida.mensajes[0])["id"], id.0);
}

#[test]
fn espacios_y_interfaz() {
    let mut nav = Browser::new();
    let segundo = nav.add_workspace("Trabajo");
    let mut puente = Puente::new(&nav);

    let salida = puente
        .orden(
            &mut nav,
            &accion("cambiar-espacio", json!({ "espacio": segundo.0 })),
        )
        .unwrap();
    assert_eq!(tipos(&salida.mensajes), ["espacio-activado"]);
    assert_eq!(json_de(&salida.mensajes[0])["id"], segundo.0);

    let salida = puente
        .orden(&mut nav, &accion("alternar-barra", json!({})))
        .unwrap();
    assert_eq!(tipos(&salida.mensajes), ["interfaz"]);
    assert_eq!(json_de(&salida.mensajes[0])["barraVisible"], false);
}

#[test]
fn mover_pestana_entre_espacios() {
    let mut nav = Browser::new();
    let segundo = nav.add_workspace("Trabajo");
    let mut puente = Puente::new(&nav);
    puente
        .orden(&mut nav, &accion("nueva-pestana", json!({})))
        .unwrap();
    let id = nav.active_tab.unwrap();
    let salida = puente
        .orden(
            &mut nav,
            &accion("mover-pestana", json!({ "pestana": id.0, "a": segundo.0 })),
        )
        .unwrap();
    let t = tipos(&salida.mensajes);
    assert!(t.contains(&"pestana-actualizada".to_string()));
    assert!(t.contains(&"espacios".to_string()));
}

#[test]
fn mensajes_invalidos_dan_error_sin_tocar_el_estado() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    assert!(puente.orden(&mut nav, "no es json").is_err());
    assert!(puente.orden(&mut nav, r#"{"tipo":"borrar-todo"}"#).is_err());
    assert!(
        puente
            .orden(&mut nav, &accion("cerrar-pestana", json!({})))
            .is_err()
    );
    assert!(nav.tabs.is_empty());
}

#[test]
fn accion_sobre_pestana_inexistente_no_emite_nada() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    let salida = puente
        .orden(
            &mut nav,
            &accion("navegar", json!({ "pestana": 99, "texto": "x" })),
        )
        .unwrap();
    assert!(salida.efectos.is_empty() && salida.mensajes.is_empty());
    assert!(nav.tab(TabId(99)).is_none());
}

#[test]
fn peticion_y_respuesta() {
    let mut nav = Browser::new();
    let mut puente = Puente::new(&nav);
    let salida = puente
        .orden(
            &mut nav,
            r#"{"tipo":"peticion","id":7,"metodo":"leer","args":{"ruta":"a.json"}}"#,
        )
        .unwrap();
    assert_eq!(
        salida.peticion,
        Some(Peticion {
            id: 7,
            metodo: "leer".into(),
            args: json!({ "ruta": "a.json" })
        })
    );
    assert!(salida.mensajes.is_empty());

    let ok = json_de(&Puente::respuesta(7, Ok(json!("hola"))));
    assert_eq!(
        (ok["tipo"].as_str(), ok["id"].as_u64(), ok["ok"].as_bool()),
        (Some("respuesta"), Some(7), Some(true))
    );
    assert_eq!(ok["valor"], "hola");
    let mal = json_de(&Puente::respuesta(8, Err("falló".into())));
    assert_eq!(
        (mal["ok"].as_bool(), mal["error"].as_str()),
        (Some(false), Some("falló"))
    );
}

fn carpeta_temporal(nombre: &str) -> std::path::PathBuf {
    let ruta = std::env::temp_dir().join(format!("rustron-bridge-{nombre}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&ruta);
    std::fs::create_dir_all(&ruta).unwrap();
    ruta
}

#[test]
fn almacen_lee_escribe_y_devuelve_null_si_no_existe() {
    let raiz = carpeta_temporal("rw");
    let almacen = Almacen::new(&raiz);
    assert_eq!(
        almacen.atender("leer", &json!({ "ruta": "sub/a.json" })),
        Ok(Value::Null)
    );
    almacen
        .atender(
            "escribir",
            &json!({ "ruta": "sub/a.json", "texto": "{\"x\":1}" }),
        )
        .unwrap();
    assert_eq!(
        almacen.atender("leer", &json!({ "ruta": "sub/a.json" })),
        Ok(json!("{\"x\":1}"))
    );
    // También acepta la ruta absoluta dentro del perfil.
    let absoluta = raiz.join("sub/a.json");
    assert_eq!(
        almacen.atender("leer", &json!({ "ruta": absoluta.to_str().unwrap() })),
        Ok(json!("{\"x\":1}"))
    );
    assert!(!raiz.join("sub/a.json.tmp").exists());
    std::fs::remove_dir_all(raiz).unwrap();
}

#[test]
fn almacen_no_deja_salir_del_perfil() {
    let raiz = carpeta_temporal("seguro");
    let almacen = Almacen::new(&raiz);
    for ruta in ["../fuera.json", "a/../../fuera.json", "/etc/passwd"] {
        assert!(
            almacen.atender("leer", &json!({ "ruta": ruta })).is_err(),
            "leer {ruta}"
        );
        assert!(
            almacen
                .atender("escribir", &json!({ "ruta": ruta, "texto": "x" }))
                .is_err(),
            "escribir {ruta}"
        );
    }
    assert!(!raiz.parent().unwrap().join("fuera.json").exists());
    assert!(almacen.atender("borrar", &json!({})).is_err());
    assert!(almacen.atender("leer", &json!({})).is_err());
    std::fs::remove_dir_all(raiz).unwrap();
}
