#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TabId(pub u64);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tab {
    pub id: TabId,
    pub title: String,
    pub uri: String,
    pub loading: bool,
    pub pinned: bool,
    /// Icono de la pestaña como URI `data:` (lo calcula quien tiene el motor); `None` si no hay.
    pub icon: Option<String>,
}

impl Tab {
    pub fn new(id: TabId, uri: String) -> Self {
        Self {
            id,
            title: String::new(),
            uri,
            loading: false,
            pinned: false,
            icon: None,
        }
    }
}
