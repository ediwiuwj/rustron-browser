use crate::action::{Action, Effect, EngineEvent};
use crate::tab::{Tab, TabId};
use crate::workspace::{Workspace, WorkspaceId};

const PAGINA_INICIAL: &str = "about:blank";
const BUSCADOR: &str = "https://duckduckgo.com/?q=";

#[derive(Debug)]
pub struct Browser {
    pub tabs: Vec<Tab>,
    pub workspaces: Vec<Workspace>,
    pub active_workspace: WorkspaceId,
    pub active_tab: Option<TabId>,
    pub sidebar_visible: bool,
    pub compact: bool,
    pub url_bar_open: bool,
    next_id: u64,
    next_workspace_id: u64,
}

impl Default for Browser {
    fn default() -> Self {
        Self::new()
    }
}

impl Browser {
    pub fn new() -> Self {
        let principal = WorkspaceId(1);
        Self {
            tabs: Vec::new(),
            workspaces: vec![Workspace {
                id: principal,
                name: "Space".into(),
                tabs: Vec::new(),
            }],
            active_workspace: principal,
            active_tab: None,
            sidebar_visible: true,
            compact: false,
            url_bar_open: false,
            next_id: 1,
            next_workspace_id: 2,
        }
    }

    pub fn add_workspace(&mut self, name: &str) -> WorkspaceId {
        let id = WorkspaceId(self.next_workspace_id);
        self.next_workspace_id += 1;
        self.workspaces.push(Workspace {
            id,
            name: name.into(),
            tabs: Vec::new(),
        });
        id
    }

    pub fn tab(&self, id: TabId) -> Option<&Tab> {
        self.tabs.iter().find(|t| t.id == id)
    }

    pub fn workspace(&self, id: WorkspaceId) -> Option<&Workspace> {
        self.workspaces.iter().find(|ws| ws.id == id)
    }

    pub fn dispatch(&mut self, action: Action) -> Vec<Effect> {
        match action {
            Action::NewTab { uri, workspace } => {
                let destino = workspace.unwrap_or(self.active_workspace);
                if self.workspace(destino).is_none() {
                    return Vec::new();
                }
                let id = self.next_id();
                if let Some(ws) = self.workspace_mut(destino) {
                    ws.tabs.push(id);
                }
                self.tabs.push(Tab::new(id, PAGINA_INICIAL.into()));
                self.active_tab = Some(id);
                match uri {
                    Some(input) => self.navigate(id, &input),
                    None => Vec::new(),
                }
            }
            Action::CloseTab(id) => {
                let Some(pos) = self.tabs.iter().position(|t| t.id == id) else {
                    return Vec::new();
                };
                self.tabs.remove(pos);

                let mut posicion_en_ws = None;
                for ws in &mut self.workspaces {
                    if let Some(p) = ws.tabs.iter().position(|t| *t == id) {
                        posicion_en_ws = Some((ws.id, p));
                        ws.tabs.remove(p);
                    }
                }

                if self.active_tab == Some(id) {
                    self.active_tab = posicion_en_ws.and_then(|(ws_id, p)| {
                        self.workspace(ws_id)
                            .and_then(|ws| ws.tabs.get(p).or(ws.tabs.last()).copied())
                    });
                }
                vec![Effect::Release(id)]
            }
            Action::ActivateTab(id) => {
                if let Some(ws_id) = self.workspace_of(id) {
                    self.active_workspace = ws_id;
                    self.active_tab = Some(id);
                }
                Vec::new()
            }
            Action::Navigate { tab, input } => self.navigate(tab, &input),
            Action::Reload { tab, hard } => {
                if self.tab(tab).is_some() {
                    vec![Effect::Reload { tab, hard }]
                } else {
                    Vec::new()
                }
            }
            Action::GoBack(tab) => {
                if self.tab(tab).is_some() {
                    vec![Effect::GoBack(tab)]
                } else {
                    Vec::new()
                }
            }
            Action::GoForward(tab) => {
                if self.tab(tab).is_some() {
                    vec![Effect::GoForward(tab)]
                } else {
                    Vec::new()
                }
            }
            Action::SwitchWorkspace(id) => {
                if let Some(ws) = self.workspace(id) {
                    self.active_tab = ws.tabs.first().copied();
                    self.active_workspace = id;
                }
                Vec::new()
            }
            Action::MoveTab { tab, to } => {
                let Some(from) = self.workspace_of(tab) else {
                    return Vec::new();
                };
                if from == to || self.workspace(to).is_none() {
                    return Vec::new();
                }
                if let Some(ws) = self.workspace_mut(from) {
                    ws.tabs.retain(|t| *t != tab);
                }
                if let Some(ws) = self.workspace_mut(to) {
                    ws.tabs.push(tab);
                }
                if self.active_tab == Some(tab) {
                    self.active_tab = self.workspace(from).and_then(|ws| ws.tabs.first().copied());
                }
                Vec::new()
            }
            Action::ToggleSidebar => {
                self.sidebar_visible = !self.sidebar_visible;
                Vec::new()
            }
            Action::ToggleCompact => {
                self.compact = !self.compact;
                Vec::new()
            }
            Action::ToggleAdblock { site } => vec![Effect::ToggleAdblock { site }],
            Action::OpenUrlBar => {
                self.url_bar_open = true;
                Vec::new()
            }
        }
    }

    pub fn apply_event(&mut self, evento: EngineEvent) {
        match evento {
            EngineEvent::TitleChanged { tab, title } => {
                if let Some(t) = self.tab_mut(tab) {
                    t.title = title;
                }
            }
            EngineEvent::UrlChanged { tab, uri } => {
                if let Some(t) = self.tab_mut(tab) {
                    t.uri = uri;
                }
            }
            EngineEvent::LoadingChanged { tab, loading } => {
                if let Some(t) = self.tab_mut(tab) {
                    t.loading = loading;
                }
            }
            EngineEvent::Closed(tab) => {
                self.dispatch(Action::CloseTab(tab));
            }
        }
    }

    fn navigate(&mut self, tab: TabId, input: &str) -> Vec<Effect> {
        let uri = resolve_input(input);
        match self.tab_mut(tab) {
            Some(t) => {
                t.uri = uri.clone();
                t.loading = true;
                vec![Effect::Navigate { tab, uri }]
            }
            None => Vec::new(),
        }
    }

    fn next_id(&mut self) -> TabId {
        let id = TabId(self.next_id);
        self.next_id += 1;
        id
    }

    fn tab_mut(&mut self, id: TabId) -> Option<&mut Tab> {
        self.tabs.iter_mut().find(|t| t.id == id)
    }

    fn workspace_mut(&mut self, id: WorkspaceId) -> Option<&mut Workspace> {
        self.workspaces.iter_mut().find(|ws| ws.id == id)
    }

    fn workspace_of(&self, tab: TabId) -> Option<WorkspaceId> {
        self.workspaces
            .iter()
            .find(|ws| ws.tabs.contains(&tab))
            .map(|ws| ws.id)
    }
}

/// Convierte lo que escribe el usuario en una URL o en una búsqueda.
pub fn resolve_input(input: &str) -> String {
    let texto = input.trim();
    if texto.contains("://") || texto.starts_with("about:") {
        return texto.to_string();
    }
    if !texto.contains(' ') && texto.contains('.') {
        return format!("https://{texto}");
    }
    format!("{BUSCADOR}{}", percent_encode(texto))
}

fn percent_encode(texto: &str) -> String {
    texto
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abrir(browser: &mut Browser, uri: Option<&str>) -> TabId {
        browser.dispatch(Action::NewTab {
            uri: uri.map(String::from),
            workspace: None,
        });
        browser.active_tab.expect("debe quedar activa")
    }

    #[test]
    fn new_tab_goes_to_active_workspace_and_becomes_active() {
        let mut b = Browser::new();
        let t = abrir(&mut b, None);
        assert_eq!(b.active_tab, Some(t));
        assert_eq!(b.workspace(b.active_workspace).unwrap().tabs, vec![t]);
        assert_eq!(b.tab(t).unwrap().uri, PAGINA_INICIAL);
    }

    #[test]
    fn new_tab_with_uri_navigates() {
        let mut b = Browser::new();
        let effects = b.dispatch(Action::NewTab {
            uri: Some("example.com".into()),
            workspace: None,
        });
        let t = b.active_tab.unwrap();
        assert_eq!(
            effects,
            vec![Effect::Navigate {
                tab: t,
                uri: "https://example.com".into()
            }]
        );
        assert!(b.tab(t).unwrap().loading);
    }

    #[test]
    fn closing_active_tab_selects_its_neighbor() {
        let mut b = Browser::new();
        let _primera = abrir(&mut b, None);
        let segunda = abrir(&mut b, None);
        let tercera = abrir(&mut b, None);
        b.dispatch(Action::ActivateTab(segunda));
        let effects = b.dispatch(Action::CloseTab(segunda));
        assert_eq!(b.active_tab, Some(tercera));
        assert_eq!(effects, vec![Effect::Release(segunda)]);
        assert!(b.tab(segunda).is_none());
    }

    #[test]
    fn closing_last_tab_clears_active() {
        let mut b = Browser::new();
        let t = abrir(&mut b, None);
        b.dispatch(Action::CloseTab(t));
        assert_eq!(b.active_tab, None);
        assert!(b.tabs.is_empty());
    }

    #[test]
    fn unknown_tab_is_a_no_op() {
        let mut b = Browser::new();
        assert!(b.dispatch(Action::CloseTab(TabId(99))).is_empty());
        assert!(b.dispatch(Action::GoBack(TabId(99))).is_empty());
        assert!(
            b.dispatch(Action::Navigate {
                tab: TabId(99),
                input: "x.org".into()
            })
            .is_empty()
        );
    }

    #[test]
    fn switch_workspace_selects_its_first_tab() {
        let mut b = Browser::new();
        let _principal = abrir(&mut b, None);
        let trabajo = b.add_workspace("Trabajo");
        let otra = b.dispatch(Action::NewTab {
            uri: None,
            workspace: Some(trabajo),
        });
        assert!(otra.is_empty());
        let en_trabajo = b.workspace(trabajo).unwrap().tabs[0];
        b.dispatch(Action::SwitchWorkspace(trabajo));
        assert_eq!(b.active_workspace, trabajo);
        assert_eq!(b.active_tab, Some(en_trabajo));
    }

    #[test]
    fn moving_active_tab_to_another_workspace_deselects_it() {
        let mut b = Browser::new();
        let t = abrir(&mut b, None);
        let trabajo = b.add_workspace("Trabajo");
        b.dispatch(Action::MoveTab {
            tab: t,
            to: trabajo,
        });
        assert_eq!(b.workspace(trabajo).unwrap().tabs, vec![t]);
        assert!(b.workspace(WorkspaceId(1)).unwrap().tabs.is_empty());
        assert_eq!(b.active_tab, None);
    }

    #[test]
    fn engine_events_update_tab_state() {
        let mut b = Browser::new();
        let t = abrir(&mut b, None);
        b.apply_event(EngineEvent::TitleChanged {
            tab: t,
            title: "Hola".into(),
        });
        b.apply_event(EngineEvent::UrlChanged {
            tab: t,
            uri: "https://a.org".into(),
        });
        b.apply_event(EngineEvent::LoadingChanged {
            tab: t,
            loading: true,
        });
        let tab = b.tab(t).unwrap();
        assert_eq!(tab.title, "Hola");
        assert_eq!(tab.uri, "https://a.org");
        assert!(tab.loading);

        b.apply_event(EngineEvent::Closed(t));
        assert!(b.tab(t).is_none());
        assert_eq!(b.active_tab, None);
    }

    #[test]
    fn toggles_flip_ui_flags() {
        let mut b = Browser::new();
        assert!(b.sidebar_visible);
        b.dispatch(Action::ToggleSidebar);
        b.dispatch(Action::ToggleCompact);
        assert!(!b.sidebar_visible);
        assert!(b.compact);
    }

    #[test]
    fn resolve_input_handles_urls_and_searches() {
        assert_eq!(resolve_input("example.com"), "https://example.com");
        assert_eq!(resolve_input("https://a.org/x"), "https://a.org/x");
        assert_eq!(resolve_input("about:blank"), "about:blank");
        assert_eq!(resolve_input("rust lang"), format!("{BUSCADOR}rust%20lang"));
    }
}
