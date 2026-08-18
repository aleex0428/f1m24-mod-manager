// ─── db.rs — JSON database layer ──────────────────────────────
//
// Two files in the OS app data directory, split by write frequency:
//
//   mods.json     the installed library and settings. Small, rewritten on
//                 every toggle, install and preference change.
//   catalog.json  the scraped Overtake listing. Hundreds of KB, rewritten
//                 only when the catalogue is synced.
//
// They used to share one file, which meant toggling a single mod rewrote the
// entire catalogue along with it.

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

    // ── Added in 1.1.0 ──────────────────────────────────────────
    //
    // `serde(default)` is not optional here. Every field added to this struct
    // must have one, because `mods.json` written by an older build has no such
    // key — and a failed parse is not a small thing: `DbStore` renames an
    // unreadable library to `mods.corrupt.json` and starts empty. Without these
    // attributes, updating the app would look exactly like losing your library.
    /// The user's own note about this mod.
    #[serde(default)]
    pub notes: Option<String>,
    /// Pinned by the user, for the handful they actually care about.
    #[serde(default)]
    pub favourite: bool,
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

/// In-memory view of both files. Callers never care which file a field is in.
#[derive(Debug, Default, Clone)]
pub struct AppDatabase {
    pub mods: HashMap<String, ModRecord>,
    pub mod_cache: HashMap<String, ModCache>,
    pub settings: HashMap<String, String>,
}

/// On-disk shape of `mods.json`.
#[derive(Debug, Serialize, Deserialize, Default)]
struct LibraryFile {
    #[serde(default)]
    mods: HashMap<String, ModRecord>,
    #[serde(default)]
    settings: HashMap<String, String>,
    /// Read but never written back: builds before 1.0.1 kept the catalogue here.
    #[serde(default, skip_serializing)]
    mod_cache: HashMap<String, ModCache>,
}

/// On-disk shape of `catalog.json`.
#[derive(Debug, Serialize, Deserialize, Default)]
struct CatalogFile {
    #[serde(default)]
    mod_cache: HashMap<String, ModCache>,
}

pub struct DbStore {
    path: PathBuf,
    catalog_path: PathBuf,
    pub data: AppDatabase,
}

impl DbStore {
    pub fn new(path: PathBuf) -> Self {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }
        let catalog_path = path.with_file_name("catalog.json");
        let mut created_new = !path.exists();

        let library: LibraryFile = if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_else(|e| {
                // Never start from scratch silently: keep the unreadable file
                // so an installed library can be recovered by hand.
                eprintln!("mods.json is unreadable ({e}); starting a fresh database");
                let _ = fs::rename(&path, path.with_extension("corrupt.json"));
                created_new = true;
                LibraryFile::default()
            })
        } else {
            LibraryFile::default()
        };

        let catalog: CatalogFile = fs::read_to_string(&catalog_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default();

        // Migration: lift a catalogue still embedded in mods.json into its own
        // file. A backup is kept, because this rewrites the user's library.
        let migrating = catalog.mod_cache.is_empty() && !library.mod_cache.is_empty();

        let store = Self {
            path,
            catalog_path,
            data: AppDatabase {
                mods: library.mods,
                settings: library.settings,
                mod_cache: if migrating { library.mod_cache } else { catalog.mod_cache },
            },
        };

        if migrating {
            let _ = fs::copy(&store.path, store.path.with_extension("json.bak"));
            store.save_catalog().ok();
            store.save().ok();
        } else if created_new {
            store.save().ok();
        }

        store
    }

    /// Write the library. Hot path: every toggle and setting change lands here.
    pub fn save(&self) -> Result<(), String> {
        write_atomic(
            &self.path,
            &LibraryFile {
                mods: self.data.mods.clone(),
                settings: self.data.settings.clone(),
                mod_cache: HashMap::new(),
            },
        )
    }

    /// Write the scraped catalogue. Only the sync path needs this.
    pub fn save_catalog(&self) -> Result<(), String> {
        write_atomic(
            &self.catalog_path,
            &CatalogFile {
                mod_cache: self.data.mod_cache.clone(),
            },
        )
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

/// Serialize to a temp file and rename over the target, so an interrupted write
/// can never leave a half-written file behind.
fn write_atomic<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let content = serde_json::to_string(value).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("f1m24-db-test-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_pre_1_1_mod_record_still_parses() {
        // Byte for byte the shape 1.0.x wrote: no `notes`, no `favourite`.
        // If this ever fails, upgrading the app wipes people's libraries.
        let legacy = r#"{
          "id": "abc",
          "name": "F1 Elite",
          "author": "Chase Chance",
          "version": "1.1.2",
          "description": null,
          "imageUrl": null,
          "tags": [],
          "parentModId": null,
          "installedFilenames": ["pakchunk99-WindowsNoEditor.pak"],
          "pakchunks": [99],
          "checksum": "deadbeef",
          "enabled": true,
          "loadOrder": 0,
          "installedAt": "2026-08-11T00:00:00Z",
          "sourceUrl": null
        }"#;

        let record: ModRecord = serde_json::from_str(legacy).expect("old records must still load");
        assert_eq!(record.name, "F1 Elite");
        assert_eq!(record.notes, None);
        assert!(!record.favourite);
    }

    fn legacy_file() -> String {
        // Exactly the shape 1.0.0 wrote: one file holding all three sections.
        r#"{
          "mods": {},
          "mod_cache": {
            "85465": {
              "overtakeId": "85465",
              "title": "F1 Elite",
              "url": "https://www.overtake.gg/downloads/f1-elite.85465/",
              "version": "1.1.2",
              "author": "Chase Chance",
              "description": "",
              "imageUrl": "",
              "downloadCount": 10,
              "lastUpdated": "2026-08-11"
            }
          },
          "settings": { "game_path": "C:\\Games\\F1" }
        }"#
        .to_string()
    }

    #[test]
    fn migrates_a_single_file_database_into_two() {
        let dir = temp_dir("migrate");
        let path = dir.join("mods.json");
        fs::write(&path, legacy_file()).unwrap();

        let store = DbStore::new(path.clone());

        // Nothing is lost in memory.
        assert_eq!(store.data.mod_cache.len(), 1);
        assert_eq!(store.get_setting("game_path").as_deref(), Some(r"C:\Games\F1"));

        // The catalogue now lives in its own file...
        let catalog: CatalogFile =
            serde_json::from_str(&fs::read_to_string(dir.join("catalog.json")).unwrap()).unwrap();
        assert_eq!(catalog.mod_cache.len(), 1);

        // ...and no longer bloats the library file.
        let library = fs::read_to_string(&path).unwrap();
        assert!(!library.contains("mod_cache"), "library still carries the catalogue");
        assert!(library.contains("game_path"));

        // The original is kept, because migrating rewrites the user's data.
        assert!(dir.join("mods.json.bak").exists(), "no backup was written");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reads_an_already_split_database() {
        let dir = temp_dir("split");
        let path = dir.join("mods.json");
        fs::write(&path, r#"{"mods":{},"settings":{"a":"b"}}"#).unwrap();
        fs::write(
            dir.join("catalog.json"),
            r#"{"mod_cache":{"1":{"overtakeId":"1","title":"T","url":"u","version":null,"author":null,"description":null,"imageUrl":null,"downloadCount":0,"lastUpdated":"2026-01-01"}}}"#,
        )
        .unwrap();

        let store = DbStore::new(path);
        assert_eq!(store.data.mod_cache.len(), 1);
        assert_eq!(store.get_setting("a").as_deref(), Some("b"));
        assert!(!dir.join("mods.json.bak").exists(), "migrated when it should not have");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn keeps_an_unreadable_library_instead_of_dropping_it() {
        let dir = temp_dir("corrupt");
        let path = dir.join("mods.json");
        fs::write(&path, "{ this is not json").unwrap();

        let store = DbStore::new(path.clone());

        assert!(store.data.mods.is_empty());
        assert!(dir.join("mods.corrupt.json").exists(), "the damaged file was discarded");

        fs::remove_dir_all(&dir).ok();
    }
}
