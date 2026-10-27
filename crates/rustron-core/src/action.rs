use crate::{tab::TabId, workspace::WorkspaceId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    NewTab {
        uri: Option<String>,
        workspace: Option<WorkspaceId>,
    },
    CloseTab(TabId),
    ActivateTab(TabId),
    Navigate {
        tab: TabId,
        input: String,
    },
    Reload {
        tab: TabId,
        hard: bool,
    },
    GoBack(TabId),
    GoForward(TabId),
    SwitchWorkspace(WorkspaceId),
    MoveTab {
        tab: TabId,
        to: WorkspaceId,
    },
    ToggleSidebar,
    ToggleCompact,
    ToggleAdblock {
        site: Option<String>,
    },
    OpenUrlBar,
}

/// Órdenes que el motor y los servicios deben ejecutar tras una acción.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    Navigate { tab: TabId, uri: String },
    Reload { tab: TabId, hard: bool },
    GoBack(TabId),
    GoForward(TabId),
    Release(TabId),
    ToggleAdblock { site: Option<String> },
}

/// Cambios que reporta el motor web sobre una pestaña.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineEvent {
    TitleChanged { tab: TabId, title: String },
    UrlChanged { tab: TabId, uri: String },
    LoadingChanged { tab: TabId, loading: bool },
    Closed(TabId),
}
