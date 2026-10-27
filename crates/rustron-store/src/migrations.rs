use rusqlite::Connection;

const MIGRACIONES: &[&str] = &[
    "CREATE TABLE history (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        visited_at INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX idx_history_url ON history(url);
    CREATE INDEX idx_history_time ON history(visited_at DESC);
    CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        position INTEGER NOT NULL
    );
    CREATE TABLE session_tabs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        url TEXT NOT NULL,
        title TEXT,
        position INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0
    );",
    "CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE site_prefs (
        host TEXT PRIMARY KEY,
        adblock INTEGER,
        permissions TEXT
    );",
];

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |fila| fila.get(0))?;
    for (indice, sql) in MIGRACIONES.iter().enumerate().skip(version as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (indice + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn latest_version() -> i64 {
    MIGRACIONES.len() as i64
}
