// ─── db.rs — JSON database layer ──────────────────────────────
//
// Uses serde_json for storage.
// Database file lives in the OS app data directory (mods.json).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModRecord {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub tags: Vec<String>,
    pub parent_mod_id: Option<String>,
    pub installed_filenames: Vec<String>, // the .pak files we installed
    pub pakchunks: Vec<i64>,              // for conflict detection
    pub checksum: String,
    pub enabled: bool,
    pub load_order: i32,
    pub installed_at: String,
    pub source_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModCache {
    pub overtake_id: String,
    pub title: String,
    pub url: String,
    pub version: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub download_count: i64,
    pub last_updated: String,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppDatabase {
    pub mods: HashMap<String, ModRecord>,
    pub mod_cache: HashMap<String, ModCache>,
    pub settings: HashMap<String, String>,
}

pub struct DbStore {
    path: PathBuf,
    pub data: AppDatabase,
}

impl DbStore {
    pub fn new(path: PathBuf) -> Self {
        let mut created_new = false;

        let data = if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
            match serde_json::from_str(&content) {
                Ok(data) => data,
                Err(e) => {
                    // Never start from scratch silently: keep the unreadable
                    // file so an installed library can be recovered by hand.
                    eprintln!("mods.json is unreadable ({e}); starting a fresh database");
                    let _ = fs::rename(&path, path.with_extension("corrupt.json"));
                    created_new = true;
                    AppDatabase::default()
                }
            }
        } else {
            created_new = true;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).ok();
            }
            AppDatabase::default()
        };

        let store = Self { path, data };
        if created_new {
            store.save().ok();
        }
        store
    }

    /// Write atomically: a crash mid-save must never truncate the library.
    pub fn save(&self) -> Result<(), String> {
        let content = serde_json::to_string(&self.data).map_err(|e| e.to_string())?;
        let tmp_path = self.path.with_extension("tmp");
        fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
        fs::rename(&tmp_path, &self.path).map_err(|e| e.to_string())
    }

    // Settings helpers
    pub fn get_setting(&self, key: &str) -> Option<String> {
        self.data.settings.get(key).cloned()
    }

    pub fn set_setting(&mut self, key: String, value: String) -> Result<(), String> {
        self.data.settings.insert(key, value);
        self.save()
    }
}
