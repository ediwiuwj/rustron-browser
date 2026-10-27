mod migrations;
mod store;

pub use migrations::latest_version;
pub use store::{HistoryEntry, SessionTab, SessionWorkspace, Store};
