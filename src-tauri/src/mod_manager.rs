// ─── mod_manager.rs — Core mod management ───────────────────────
//
// Handles: install, toggle, get, delete, conflicts, load order.
//
// File naming rules used across this module:
//   pakchunk99-WindowsNoEditor.pak            → base "pakchunk99-WindowsNoEditor"
//   pakchunk99-WindowsNoEditor_100_P.pak      → same base, load-order priority 100
//   pakchunk99-WindowsNoEditor_100_P.pak.disabled → same, currently disabled
// A mod may also ship .ucas/.utoc/.sig siblings that must always travel with
// their .pak, so every rename/move/delete operates on the whole group.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::State;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;
use walkdir::WalkDir;
use chrono::Utc;

use crate::{db::ModRecord, game_detector::get_mods_dir, AppState};

/// Extensions that belong to a mod package.
const MOD_EXTS: [&str; 4] = ["pak", "ucas", "utoc", "sig"];
const DISABLED_SUFFIX: &str = ".disabled";

// ─── Data types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub pakchunk: i64,
    pub mods: Vec<String>,      // mod ids
    pub mod_names: Vec<String>, // mod names
}

/// A mod file on disk, decomposed into its meaningful parts.
struct ModFile {
    path: PathBuf,
    base: String,
    ext: String,
    disabled: bool,
}

// ─── Commands ────────────────────────────────────────────────────

/// Return all installed mods.
#[tauri::command]
pub fn get_mods(state: State<AppState>) -> Result<Vec<ModRecord>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut mods: Vec<ModRecord> = conn.data.mods.values().cloned().collect();
    mods.sort_by_key(|m| m.load_order);
    Ok(mods)
}

/// Install a mod from an archive (.zip/.rar/.7z) or a bare .pak file.
#[tauri::command]
pub async fn install_mod(
    zip_path: String,
    source_url: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let game_path = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.get_setting("game_path")
            .filter(|p| !p.trim().is_empty())
            .ok_or("Game path is not set. Configure it in Settings first.")?
    };

    if !crate::game_detector::is_valid_game_path(&game_path) {
        return Err(
            "The configured game folder no longer contains F1Manager24.exe. Update it in Settings."
                .to_string(),
        );
    }

    let mods_dir = get_mods_dir(&game_path);
    fs::create_dir_all(&mods_dir).map_err(|e| format!("Cannot create the ~mods folder: {e}"))?;

    let source_path = Path::new(&zip_path);
    if !source_path.exists() {
        return Err(format!("File not found: {zip_path}"));
    }

    // Same mod, newer file: the previous install is removed once the new
    // archive has been unpacked successfully, never before.
    let replaced = source_url.as_ref().and_then(|surl| {
        let conn = state.db.lock().ok()?;
        conn.data
            .mods
            .values()
            .find(|m| m.source_url.as_deref() == Some(surl.as_str()))
            .map(|m| (m.id.clone(), m.load_order))
    });
    let replaced_mod_id = replaced.as_ref().map(|(id, _)| id.clone());

    let mut mod_name = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Mod")
        .to_string();

    let is_already_pak = source_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.eq_ignore_ascii_case("pak"))
        .unwrap_or(false);

    // Collect { base → files } for everything we are about to install.
    let mut groups: HashMap<String, Vec<PathBuf>> = HashMap::new();
    let mut temp_extract_dir: Option<PathBuf> = None;

    if is_already_pak {
        let name = source_path.file_name().unwrap().to_string_lossy().to_string();
        let base = base_of(&name).unwrap_or_else(|| mod_name.clone());
        groups.entry(base).or_default().push(source_path.to_path_buf());
    } else {
        let extract_dir = crate::downloader::downloads_temp_root()
            .join(format!("extract_{}", Uuid::new_v4()));
        fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
        temp_extract_dir = Some(extract_dir.clone());

        let sidecar = app_handle
            .shell()
            .sidecar("sevenza")
            .map_err(|e| format!("Extractor unavailable: {e}"))?;

        let output_arg = format!("-o{}", extract_dir.display());
        let output = sidecar
            .args(["x", source_path.to_str().unwrap_or_default(), "-y", &output_arg])
            .output()
            .await
            .map_err(|e| format!("Extractor failed to run: {e}"))?;

        if !output.status.success() {
            let _ = fs::remove_dir_all(&extract_dir);
            return Err("The archive is corrupted, password-protected, or not a supported format.".to_string());
        }

        for entry in WalkDir::new(&extract_dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if let Some(base) = base_of(name) {
                groups.entry(base).or_default().push(path.to_path_buf());
            }
        }
    }

    if !groups.values().any(|files| files.iter().any(|f| has_ext(f, "pak"))) {
        if let Some(dir) = &temp_extract_dir {
            let _ = fs::remove_dir_all(dir);
        }
        return Err("No installable mod files (.pak) were found inside this archive.".to_string());
    }

    // The new archive is valid — now it is safe to retire the old version.
    if let Some(old_id) = &replaced_mod_id {
        let _ = delete_mod(old_id.clone(), state.clone());
    }

    // Move every group into ~mods, renaming on collision.
    let mut pak_files: Vec<String> = Vec::new();
    let mut duplicate_counter = 0;

    let mut ordered_bases: Vec<String> = groups.keys().cloned().collect();
    ordered_bases.sort();

    for base in ordered_bases {
        let files = groups.remove(&base).unwrap_or_default();
        if !files.iter().any(|f| has_ext(f, "pak")) {
            continue; // orphan .ucas/.utoc without its .pak
        }

        // Pick a base name that is free in ~mods.
        let mut final_base = base.clone();
        while base_exists_in(&mods_dir, &final_base) || pak_files.contains(&format!("{final_base}.pak")) {
            duplicate_counter += 1;
            final_base = format!("{duplicate_counter}_{base}");
        }

        for file in files {
            let ext = file
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("pak")
                .to_ascii_lowercase();
            let dest = mods_dir.join(format!("{final_base}.{ext}"));

            if is_already_pak {
                fs::copy(&file, &dest).map_err(|e| format!("Cannot copy {ext} file: {e}"))?;
            } else if fs::rename(&file, &dest).is_err() {
                // Different volume: fall back to copy.
                fs::copy(&file, &dest).map_err(|e| format!("Cannot move {ext} file: {e}"))?;
            }
        }

        pak_files.push(format!("{final_base}.pak"));
    }

    if let Some(dir) = &temp_extract_dir {
        let _ = fs::remove_dir_all(dir);
    }

    if is_already_pak {
        mod_name = base_of(&source_path.file_name().unwrap().to_string_lossy())
            .unwrap_or(mod_name);
    }

    let first_pak = mods_dir.join(&pak_files[0]);
    let checksum = sha256_file(&first_pak).unwrap_or_default();
    let pakchunks = extract_pakchunks(&pak_files);
    let mod_id = Uuid::new_v4().to_string();

    {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;

        // Pull nice metadata (title, author, version, cover) from the catalog.
        let catalog = source_url.as_ref().and_then(|surl| {
            let key = surl.trim_end_matches('/').trim_end_matches("/download");
            conn.data
                .mod_cache
                .values()
                .find(|c| c.url.trim_end_matches('/') == key)
                .cloned()
        });

        // An update keeps the slot its previous version occupied.
        let load_order = replaced.as_ref().map(|(_, order)| *order).unwrap_or_else(|| {
            conn.data.mods.values().map(|m| m.load_order).max().map_or(0, |m| m + 1)
        });

        let record = ModRecord {
            id: mod_id.clone(),
            name: catalog
                .as_ref()
                .map(|c| c.title.clone())
                .filter(|t| !t.trim().is_empty())
                .unwrap_or(mod_name),
            author: catalog.as_ref().and_then(|c| c.author.clone()).filter(|a| !a.is_empty()),
            version: catalog.as_ref().and_then(|c| c.version.clone()).filter(|v| !v.is_empty()),
            description: catalog
                .as_ref()
                .and_then(|c| c.description.clone())
                .filter(|d| !d.is_empty()),
            image_url: catalog.as_ref().and_then(|c| c.image_url.clone()).filter(|i| !i.is_empty()),
            tags: vec![],
            parent_mod_id: None,
            installed_filenames: pak_files,
            pakchunks,
            checksum,
            enabled: true,
            load_order,
            installed_at: Utc::now().to_rfc3339(),
            source_url,
        };

        conn.data.mods.insert(mod_id.clone(), record);
        conn.save()?;
    }

    Ok(mod_id)
}

/// Toggle a mod on or off by adding/removing the `.disabled` marker.
#[tauri::command]
pub fn toggle_mod(mod_id: String, enabled: bool, state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    let game_path = conn
        .get_setting("game_path")
        .filter(|p| !p.trim().is_empty())
        .ok_or("Game path is not configured")?;

    let mod_record = conn
        .data
        .mods
        .get_mut(&mod_id)
        .ok_or(format!("Mod {mod_id} not found"))?;

    let pak_files = mod_record.installed_filenames.clone();
    let active_dir = get_mods_dir(&game_path);
    fs::create_dir_all(&active_dir).map_err(|e| e.to_string())?;

    let on_disk = read_mod_files(&active_dir);

    for pak in &pak_files {
        let Some(base) = base_of(pak) else { continue };

        for file in on_disk.iter().filter(|f| f.base == base) {
            if file.disabled == !enabled {
                continue; // already in the requested state
            }
            let name = file.path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let new_name = if enabled {
                name.trim_end_matches(DISABLED_SUFFIX).to_string()
            } else {
                format!("{name}{DISABLED_SUFFIX}")
            };
            let dst = active_dir.join(new_name);
            if file.path != dst {
                fs::rename(&file.path, &dst)
                    .map_err(|e| format!("Cannot {} {}: {e}", if enabled { "enable" } else { "disable" }, pak))?;
            }
        }
    }

    mod_record.enabled = enabled;
    conn.save()?;

    Ok(())
}

/// Delete a mod and every file that belongs to it.
#[tauri::command]
pub fn delete_mod(mod_id: String, state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let game_path = conn.get_setting("game_path").unwrap_or_default();

    if let Some(mod_record) = conn.data.mods.remove(&mod_id) {
        if !game_path.is_empty() {
            let active_dir = get_mods_dir(&game_path);
            let on_disk = read_mod_files(&active_dir);

            for pak in &mod_record.installed_filenames {
                let Some(base) = base_of(pak) else { continue };
                for file in on_disk.iter().filter(|f| f.base == base) {
                    let _ = fs::remove_file(&file.path);
                }
            }
        }
        conn.save()?;
    }

    Ok(())
}

/// Detect conflicts between enabled mods sharing the same pakchunk.
#[tauri::command]
pub fn detect_conflicts(state: State<AppState>) -> Result<Vec<ConflictInfo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut chunk_map: HashMap<i64, Vec<(String, String)>> = HashMap::new();

    for m in conn.data.mods.values().filter(|m| m.enabled) {
        for chunk in &m.pakchunks {
            chunk_map
                .entry(*chunk)
                .or_default()
                .push((m.id.clone(), m.name.clone()));
        }
    }

    let mut conflicts: Vec<ConflictInfo> = chunk_map
        .into_iter()
        .filter(|(_, entries)| entries.len() > 1)
        .map(|(chunk, entries)| ConflictInfo {
            pakchunk: chunk,
            mods: entries.iter().map(|(id, _)| id.clone()).collect(),
            mod_names: entries.into_iter().map(|(_, name)| name).collect(),
        })
        .collect();

    conflicts.sort_by_key(|c| c.pakchunk);
    Ok(conflicts)
}

/// Apply load order by renaming files with `_NNN_P` priority suffixes.
/// The first mod in the list wins conflicts, so it gets the highest priority.
#[tauri::command]
pub fn apply_load_order(ordered_mod_ids: Vec<String>, state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    let game_path = conn
        .get_setting("game_path")
        .filter(|p| !p.trim().is_empty())
        .ok_or("Game path is not configured")?;

    let active_dir = get_mods_dir(&game_path);
    let total = ordered_mod_ids.len();

    for (order_idx, mod_id) in ordered_mod_ids.iter().enumerate() {
        // Top of the list = loaded last = overrides the ones below it.
        let priority = (total - order_idx) * 100;
        let on_disk = read_mod_files(&active_dir);

        let Some(mod_record) = conn.data.mods.get_mut(mod_id) else {
            continue;
        };

        let mut new_pak_files = Vec::new();

        for pak in &mod_record.installed_filenames {
            let Some(base) = base_of(pak) else {
                new_pak_files.push(pak.clone());
                continue;
            };
            let new_base = format!("{base}_{priority}_P");

            for file in on_disk.iter().filter(|f| f.base == base) {
                let mut new_name = format!("{}.{}", new_base, file.ext);
                if file.disabled {
                    new_name.push_str(DISABLED_SUFFIX);
                }
                let new_path = active_dir.join(&new_name);
                if file.path != new_path {
                    fs::rename(&file.path, &new_path)
                        .map_err(|e| format!("Cannot reorder {}: {e}", pak))?;
                }
            }

            new_pak_files.push(format!("{new_base}.pak"));
        }

        mod_record.installed_filenames = new_pak_files;
        mod_record.load_order = order_idx as i32;
    }

    conn.save()?;
    Ok(())
}

/// Open the game's `~mods` folder in Explorer.
#[tauri::command]
pub fn open_mods_folder(state: tauri::State<crate::AppState>) -> Result<(), String> {
    let game_path = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.get_setting("game_path").unwrap_or_default()
    };
    if game_path.trim().is_empty() {
        return Err("Game path is not set. Configure it in Settings first.".to_string());
    }

    crate::game_detector::open_in_explorer(&get_mods_dir(&game_path))
}

/// Absolute path of the `~mods` folder, for display in the UI.
#[tauri::command]
pub fn get_mods_dir_path(state: tauri::State<crate::AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let game_path = conn.get_setting("game_path").unwrap_or_default();
    if game_path.trim().is_empty() {
        return Ok(String::new());
    }
    Ok(get_mods_dir(&game_path).to_string_lossy().to_string())
}

// ─── Private helpers ─────────────────────────────────────────────

fn has_ext(path: &Path, ext: &str) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(ext))
        .unwrap_or(false)
}

/// Base name of a mod file: no `.disabled`, no extension, no `_NNN_P` suffix.
/// Returns `None` for files that are not part of a mod package.
fn base_of(file_name: &str) -> Option<String> {
    let stem = file_name.trim_end_matches(DISABLED_SUFFIX);
    let dot = stem.rfind('.')?;
    let ext = stem[dot + 1..].to_ascii_lowercase();
    if !MOD_EXTS.contains(&ext.as_str()) {
        return None;
    }
    Some(strip_priority_suffix(&stem[..dot]))
}

/// Remove a trailing `_<digits>_P` load-order marker.
fn strip_priority_suffix(stem: &str) -> String {
    let Some(p_pos) = stem.rfind('_') else {
        return stem.to_string();
    };
    if &stem[p_pos + 1..] != "P" {
        return stem.to_string();
    }
    let Some(num_pos) = stem[..p_pos].rfind('_') else {
        return stem.to_string();
    };
    let num = &stem[num_pos + 1..p_pos];
    if !num.is_empty() && num.chars().all(|c| c.is_ascii_digit()) {
        stem[..num_pos].to_string()
    } else {
        stem.to_string()
    }
}

/// Read `~mods` once and decompose every mod file in it.
fn read_mod_files(dir: &Path) -> Vec<ModFile> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let name = path.file_name()?.to_string_lossy().to_string();
            let disabled = name.ends_with(DISABLED_SUFFIX);
            let stem = name.trim_end_matches(DISABLED_SUFFIX);
            let dot = stem.rfind('.')?;
            let ext = stem[dot + 1..].to_ascii_lowercase();
            if !MOD_EXTS.contains(&ext.as_str()) {
                return None;
            }
            Some(ModFile {
                base: strip_priority_suffix(&stem[..dot]),
                path,
                ext,
                disabled,
            })
        })
        .collect()
}

fn base_exists_in(dir: &Path, base: &str) -> bool {
    read_mod_files(dir).iter().any(|f| f.base == base)
}

/// Calculate SHA-256 hex digest of a file.
fn sha256_file(path: &PathBuf) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Extract pakchunk numbers from pak filenames.
/// E.g. "pakchunk42-WindowsNoEditor.pak" → [42]
fn extract_pakchunks(pak_files: &[String]) -> Vec<i64> {
    let mut chunks = Vec::new();
    for pak in pak_files {
        let mut lower = pak.to_lowercase();
        // Drop the "2_" collision prefix we may have added on install.
        if let Some(pos) = lower.find('_') {
            if lower[..pos].chars().all(|c| c.is_ascii_digit()) && pos > 0 {
                lower = lower[pos + 1..].to_string();
            }
        }
        if let Some(rest) = lower.strip_prefix("pakchunk") {
            let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = num_str.parse::<i64>() {
                if !chunks.contains(&n) {
                    chunks.push(n);
                }
            }
        }
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_priority_and_disabled() {
        assert_eq!(base_of("pakchunk9-WindowsNoEditor.pak").unwrap(), "pakchunk9-WindowsNoEditor");
        assert_eq!(base_of("pakchunk9_100_P.pak").unwrap(), "pakchunk9");
        assert_eq!(base_of("pakchunk9_100_P.pak.disabled").unwrap(), "pakchunk9");
        assert_eq!(base_of("pakchunk9.utoc").unwrap(), "pakchunk9");
        assert!(base_of("readme.txt").is_none());
    }

    #[test]
    fn keeps_unrelated_underscores() {
        assert_eq!(strip_priority_suffix("my_cool_mod"), "my_cool_mod");
        assert_eq!(strip_priority_suffix("my_cool_mod_100_P"), "my_cool_mod");
    }

    #[test]
    fn reads_pakchunk_numbers() {
        assert_eq!(extract_pakchunks(&["pakchunk42-WindowsNoEditor.pak".into()]), vec![42]);
    }
}
