use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::migrations::migrate;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    pub visited_at: i64,
    pub visit_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionWorkspace {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionTab {
    pub id: String,
    pub workspace_id: String,
    pub url: String,
    pub title: String,
    pub position: i64,
    pub pinned: bool,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        Self::from_connection(Connection::open(path)?)
    }

    pub fn open_in_memory() -> rusqlite::Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> rusqlite::Result<Self> {
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&conn)?;
        Ok(Self { conn })
    }

    pub fn schema_version(&self) -> rusqlite::Result<i64> {
        self.conn
            .pragma_query_value(None, "user_version", |fila| fila.get(0))
    }

    pub fn record_visit(&self, url: &str, title: &str, visited_at: i64) -> rusqlite::Result<()> {
        let existente: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM history WHERE url = ?1 ORDER BY id DESC LIMIT 1",
                [url],
                |fila| fila.get(0),
            )
            .optional()?;

        match existente {
            Some(id) => {
                self.conn.execute(
                    "UPDATE history SET title = ?1, visited_at = ?2, visit_count = visit_count + 1
                     WHERE id = ?3",
                    params![title, visited_at, id],
                )?;
            }
            None => {
                self.conn.execute(
                    "INSERT INTO history (url, title, visited_at) VALUES (?1, ?2, ?3)",
                    params![url, title, visited_at],
                )?;
            }
        }
        Ok(())
    }

    pub fn recent_history(&self, limite: i64) -> rusqlite::Result<Vec<HistoryEntry>> {
        let mut consulta = self.conn.prepare(
            "SELECT url, title, visited_at, visit_count FROM history
             ORDER BY visited_at DESC LIMIT ?1",
        )?;
        let filas = consulta.query_map([limite], leer_historial)?;
        filas.collect()
    }

    pub fn suggest(&self, texto: &str, limite: i64) -> rusqlite::Result<Vec<HistoryEntry>> {
        let mut consulta = self.conn.prepare(
            "SELECT url, COALESCE(title, ''), visited_at, visit_count FROM history
             WHERE instr(lower(url), lower(?1)) > 0
                OR instr(lower(COALESCE(title, '')), lower(?1)) > 0
             ORDER BY visit_count DESC, visited_at DESC LIMIT ?2",
        )?;
        let filas = consulta.query_map(params![texto, limite], leer_historial)?;
        filas.collect()
    }

    pub fn save_session(
        &mut self,
        workspaces: &[SessionWorkspace],
        tabs: &[SessionTab],
    ) -> rusqlite::Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM session_tabs", [])?;
        tx.execute("DELETE FROM workspaces", [])?;
        for ws in workspaces {
            tx.execute(
                "INSERT INTO workspaces (id, name, color, icon, position) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![ws.id, ws.name, ws.color, ws.icon, ws.position],
            )?;
        }
        for tab in tabs {
            tx.execute(
                "INSERT INTO session_tabs (id, workspace_id, url, title, position, pinned)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    tab.id,
                    tab.workspace_id,
                    tab.url,
                    tab.title,
                    tab.position,
                    tab.pinned
                ],
            )?;
        }
        tx.commit()
    }

    pub fn load_session(&self) -> rusqlite::Result<(Vec<SessionWorkspace>, Vec<SessionTab>)> {
        let mut consulta_ws = self
            .conn
            .prepare("SELECT id, name, color, icon, position FROM workspaces ORDER BY position")?;
        let workspaces = consulta_ws
            .query_map([], |fila| {
                Ok(SessionWorkspace {
                    id: fila.get(0)?,
                    name: fila.get(1)?,
                    color: fila.get(2)?,
                    icon: fila.get(3)?,
                    position: fila.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut consulta_tabs = self.conn.prepare(
            "SELECT id, workspace_id, url, COALESCE(title, ''), position, pinned
             FROM session_tabs ORDER BY workspace_id, position",
        )?;
        let tabs = consulta_tabs
            .query_map([], |fila| {
                Ok(SessionTab {
                    id: fila.get(0)?,
                    workspace_id: fila.get(1)?,
                    url: fila.get(2)?,
                    title: fila.get(3)?,
                    position: fila.get(4)?,
                    pinned: fila.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok((workspaces, tabs))
    }
}

fn leer_historial(fila: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        url: fila.get(0)?,
        title: fila.get(1)?,
        visited_at: fila.get(2)?,
        visit_count: fila.get(3)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::latest_version;

    fn ws(id: &str, position: i64) -> SessionWorkspace {
        SessionWorkspace {
            id: id.into(),
            name: format!("ws {id}"),
            color: Some("#89b4fa".into()),
            icon: None,
            position,
        }
    }

    fn tab(id: &str, workspace: &str, position: i64) -> SessionTab {
        SessionTab {
            id: id.into(),
            workspace_id: workspace.into(),
            url: format!("https://{id}.org"),
            title: format!("Título {id}"),
            position,
            pinned: position == 0,
        }
    }

    #[test]
    fn opens_at_latest_schema_version() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.schema_version().unwrap(), latest_version());
    }

    #[test]
    fn reopening_a_file_keeps_data_and_version() {
        let ruta = std::env::temp_dir().join(format!("rustron-store-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&ruta);
        {
            let store = Store::open(&ruta).unwrap();
            store.record_visit("https://a.org", "A", 10).unwrap();
        }
        let store = Store::open(&ruta).unwrap();
        assert_eq!(store.schema_version().unwrap(), latest_version());
        assert_eq!(store.recent_history(10).unwrap().len(), 1);
        drop(store);
        std::fs::remove_file(&ruta).unwrap();
    }

    #[test]
    fn repeated_visits_update_one_row() {
        let store = Store::open_in_memory().unwrap();
        store.record_visit("https://a.org", "Primera", 10).unwrap();
        store.record_visit("https://a.org", "Segunda", 20).unwrap();
        let historial = store.recent_history(10).unwrap();
        assert_eq!(historial.len(), 1);
        assert_eq!(historial[0].title, "Segunda");
        assert_eq!(historial[0].visit_count, 2);
        assert_eq!(historial[0].visited_at, 20);
    }

    #[test]
    fn recent_history_is_ordered_by_time() {
        let store = Store::open_in_memory().unwrap();
        store.record_visit("https://viejo.org", "", 1).unwrap();
        store.record_visit("https://nuevo.org", "", 5).unwrap();
        let urls: Vec<_> = store
            .recent_history(10)
            .unwrap()
            .into_iter()
            .map(|h| h.url)
            .collect();
        assert_eq!(urls, vec!["https://nuevo.org", "https://viejo.org"]);
    }

    #[test]
    fn suggest_matches_url_or_title() {
        let store = Store::open_in_memory().unwrap();
        store
            .record_visit("https://rust-lang.org", "Lenguaje", 1)
            .unwrap();
        store
            .record_visit("https://example.com", "Rust blog", 2)
            .unwrap();
        store.record_visit("https://otro.net", "Nada", 3).unwrap();
        let sugerencias = store.suggest("rust", 10).unwrap();
        assert_eq!(sugerencias.len(), 2);
        assert!(sugerencias.iter().all(|h| h.url != "https://otro.net"));
    }

    #[test]
    fn session_round_trip_replaces_previous_one() {
        let mut store = Store::open_in_memory().unwrap();
        let workspaces = vec![ws("principal", 0), ws("trabajo", 1)];
        let tabs = vec![tab("a", "principal", 0), tab("b", "trabajo", 0)];
        store.save_session(&workspaces, &tabs).unwrap();
        assert_eq!(store.load_session().unwrap(), (workspaces, tabs));

        store
            .save_session(&[ws("solo", 0)], &[tab("c", "solo", 0)])
            .unwrap();
        let (cargados_ws, cargadas_tabs) = store.load_session().unwrap();
        assert_eq!(cargados_ws.len(), 1);
        assert_eq!(cargadas_tabs.len(), 1);
        assert_eq!(cargadas_tabs[0].id, "c");
    }

    #[test]
    fn session_tab_must_reference_existing_workspace() {
        let mut store = Store::open_in_memory().unwrap();
        let resultado = store.save_session(&[], &[tab("a", "fantasma", 0)]);
        assert!(resultado.is_err());
    }
}
