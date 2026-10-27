use crate::tab::TabId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkspaceId(pub u64);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub tabs: Vec<TabId>,
}
