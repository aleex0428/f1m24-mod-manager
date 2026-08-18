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
/// Extensions that mean "this archive ships a program", not a mod.
const APP_EXTS: [&str; 3] = ["exe", "msi", "dll"];
const DISABLED_SUFFIX: &str = ".disabled";
/// Folder inside `~mods` holding uninstalled mods until the undo window shuts.
/// Hidden from `read_mod_files`, which only ever looks at top-level files.
const TRASH_ROOT: &str = ".f1m24-undo";
/// Appended to every trashed file, so nothing in the bin still looks like a
/// loadable `.pak` to the game.
const TRASH_SUFFIX: &str = ".deleted";
/// The mod's record, kept beside its files so a restore needs nothing else.
const TRASH_MANIFEST: &str = "mod.json";
/// Variant id meaning "take everything in the archive".
pub const VARIANT_ALL: &str = "*";
/// Prefix for a variant that is a folder inside the archive.
const VARIANT_DIR: &str = "dir:";
/// Prefix for a variant that is a single mod file among loose alternatives.
const VARIANT_PAK: &str = "pak:";

// ─── Data types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub pakchunk: i64,
    pub mods: Vec<String>,      // mod ids
    pub mod_names: Vec<String>, // mod names
}

/// One of several interchangeable versions of the same mod inside a single
/// archive — the "Option A" / "Option B" folders creators often ship.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallVariant {
    /// Path of the folder inside the archive, used as the choice token.
    pub id: String,
    pub label: String,
    pub files: Vec<String>,
}

/// An extraction parked while the user picks a variant. Holding the staging
/// directory open is what lets the install resume without downloading again.
pub struct PendingInstall {
    pub staging_dir: PathBuf,
    pub mod_name: String,
    pub source_url: Option<String>,
    /// Set when the install came from the download queue, so the job can be
    /// completed or failed once the choice is made.
    pub job_id: Option<String>,
    /// Downloaded archive, kept so it can be archived or cleaned up later.
    pub archive_path: Option<PathBuf>,
    pub archive_dir: Option<PathBuf>,
}

/// What `install_mod` did: finished, or stopped to ask a question.
///
/// `rename_all` on an enum renames the *variants*, not the fields inside them,
/// so each variant carries its own attribute. Without it the UI reads
/// `outcome.stagingId` and finds `staging_id`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum InstallOutcome {
    #[serde(rename_all = "camelCase")]
    Installed { mod_id: String },
    #[serde(rename_all = "camelCase")]
    NeedsVariant {
        staging_id: String,
        variants: Vec<InstallVariant>,
    },
}

/// A mod file on disk, decomposed into its meaningful parts.
struct ModFile {
    path: PathBuf,
    base: String,
    ext: String,
    disabled: bool,
}

// ─── Commands ────────────────────────────────────────────────────

/// Whether what the library claims is installed is actually on disk.
///
/// The library is a record of what *was* installed; the game folder is edited
/// by game updates, by anti-cheat sweeps and by hand. Until now the two were
/// never compared, so a `~mods` emptied by a patch left every mod still listed
/// as present and enabled.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ModIntegrity {
    /// Every file the record names is where it should be.
    Ok,
    /// Some of the mod's files are there and some are not.
    Incomplete,
    /// None of them are.
    Missing,
    /// Present, but the bytes no longer hash to what was installed.
    ///
    /// Never constructed here, and that is correct: `verify_mods` returns the
    /// ids it found and the UI applies this state to them, because the result
    /// is deliberately not persisted — it is a snapshot of one check, not a
    /// property of the mod. The variant exists so the Rust and TypeScript
    /// definitions of this contract stay the same shape.
    #[allow(dead_code)]
    Modified,
}

/// A mod as the UI sees it: the stored record plus what it weighs right now.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModView {
    #[serde(flatten)]
    pub record: ModRecord,
    /// Measured on every listing rather than stored: files are renamed on the
    /// disk as the load order changes, and a stale number is worse than none.
    pub size_bytes: u64,
    /// Presence check only — cheap, because it reads the directory listing the
    /// size calculation already needs. Checksums are `verify_mods`' job.
    pub integrity: ModIntegrity,
}

/// Return all installed mods.
#[tauri::command]
pub fn get_mods(state: State<AppState>) -> Result<Vec<ModView>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let game_path = conn.get_setting("game_path").unwrap_or_default();
    let mut sizes: HashMap<String, u64> = HashMap::new();
    if !game_path.trim().is_empty() {
        for file in read_mod_files(&get_mods_dir(&game_path)) {
            let bytes = fs::metadata(&file.path).map(|m| m.len()).unwrap_or(0);
            *sizes.entry(file.base).or_default() += bytes;
        }
    }

    let mut mods: Vec<ModRecord> = conn.data.mods.values().cloned().collect();
    mods.sort_by_key(|m| m.load_order);

    Ok(mods
        .into_iter()
        .map(|record| {
            let bases: Vec<String> = record
                .installed_filenames
                .iter()
                .filter_map(|name| base_of(name))
                .collect();

            let present = bases.iter().filter(|base| sizes.contains_key(*base)).count();
            let size_bytes = bases
                .iter()
                .filter_map(|base| sizes.get(base).copied())
                .sum();

            let integrity =
                integrity_from_presence(present, bases.len(), !game_path.trim().is_empty());

            ModView { record, size_bytes, integrity }
        })
        .collect())
}

/// Re-hash installed mods and report the ones whose bytes have changed.
///
/// Separate from `get_mods` on purpose: this reads every `.pak` from end to
/// end — hundreds of megabytes — and doing that on every library load would
/// make the app feel broken. Presence is checked constantly because it is
/// nearly free; content is checked when the user asks.
///
/// Returns the ids of mods that no longer match what was installed.
#[tauri::command]
pub fn verify_mods(state: State<AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let game_path = conn
        .get_setting("game_path")
        .filter(|p| !p.trim().is_empty())
        .ok_or("Game path is not configured")?;

    let on_disk = read_mod_files(&get_mods_dir(&game_path));
    let mut changed = Vec::new();

    for record in conn.data.mods.values() {
        // The checksum was taken from the first .pak at install time. Load
        // order renames add a _NNN_P suffix, so the file is found by base
        // rather than by name — the content is what is being checked.
        let Some(base) = record.installed_filenames.first().and_then(|n| base_of(n)) else {
            continue;
        };
        if record.checksum.is_empty() {
            continue; // installed before checksums were recorded
        }

        let Some(file) = on_disk
            .iter()
            .find(|f| f.base == base && f.ext == "pak")
        else {
            continue; // absent, which `get_mods` already reports
        };

        match sha256_file(&file.path) {
            Ok(hash) if hash != record.checksum => {
                log::info!("integrity: {} no longer matches its install", record.name);
                changed.push(record.id.clone());
            }
            _ => {}
        }
    }

    Ok(changed)
}

/// Enable or disable every installed mod at once.
///
/// A per-mod loop from the UI would be one IPC round-trip and one library write
/// each; this is a single pass.
#[tauri::command]
pub fn set_all_mods_enabled(enabled: bool, state: State<AppState>) -> Result<usize, String> {
    crate::game_detector::ensure_game_closed()?;

    let ids: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.data
            .mods
            .values()
            .filter(|m| m.enabled != enabled)
            .map(|m| m.id.clone())
            .collect()
    };

    let mut changed = 0;
    for id in ids {
        if toggle_mod(id, enabled, state.clone()).is_ok() {
            changed += 1;
        }
    }
    Ok(changed)
}

/// Install a mod from an archive (.zip/.rar/.7z) or a bare .pak file.
#[tauri::command]
pub async fn install_mod(
    zip_path: String,
    source_url: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<InstallOutcome, String> {
    crate::game_detector::ensure_game_closed()?;

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
    let mod_name = source_path
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
    let mut looks_like_app = false;

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
            } else if APP_EXTS.iter().any(|ext| has_ext(path, ext)) {
                // Remember it: a download that turns out to be an installer
                // deserves a better answer than "no mods found".
                looks_like_app = true;
            }
        }
    }

    if !groups.values().any(|files| files.iter().any(|f| has_ext(f, "pak"))) {
        if let Some(dir) = &temp_extract_dir {
            let _ = fs::remove_dir_all(dir);
        }
        return Err(if looks_like_app {
            "This download is an application, not a game mod, so there is nothing to install."
                .to_string()
        } else {
            "No installable mod files (.pak) were found inside this archive.".to_string()
        });
    }

    // Several files sharing a name means the archive ships alternatives that
    // cannot coexist: they would overwrite each other on the way in. Park the
    // extraction and let the user pick instead of choosing arbitrarily.
    if let Some(dir) = &temp_extract_dir {
        let variants = detect_variants(dir, &groups);
        if variants.len() > 1 {
            let staging_id = Uuid::new_v4().to_string();
            if let Ok(mut pending) = state.pending_installs.lock() {
                pending.insert(
                    staging_id.clone(),
                    PendingInstall {
                        staging_dir: dir.clone(),
                        mod_name,
                        source_url,
                        job_id: None,
                        archive_path: None,
                        archive_dir: None,
                    },
                );
            }
            return Ok(InstallOutcome::NeedsVariant { staging_id, variants });
        }
    }

    let mod_id = install_groups(
        groups,
        is_already_pak,
        &mods_dir,
        if is_already_pak {
            base_of(&source_path.file_name().unwrap_or_default().to_string_lossy())
                .unwrap_or(mod_name)
        } else {
            mod_name
        },
        source_url,
        replaced,
        state,
        &app_handle,
    )?;

    if let Some(dir) = &temp_extract_dir {
        let _ = fs::remove_dir_all(dir);
    }

    Ok(InstallOutcome::Installed { mod_id })
}

/// Move a prepared set of files into `~mods` and record the mod.
#[allow(clippy::too_many_arguments)]
fn install_groups(
    mut groups: HashMap<String, Vec<PathBuf>>,
    copy_instead_of_move: bool,
    mods_dir: &Path,
    mod_name: String,
    source_url: Option<String>,
    replaced: Option<(String, i32)>,
    state: State<AppState>,
    app: &tauri::AppHandle,
) -> Result<String, String> {
    let replaced_mod_id = replaced.as_ref().map(|(id, _)| id.clone());

    // What the user wrote about this mod belongs to the mod, not to the
    // version of it that happens to be installed. Updating a mod must not
    // silently throw away a note explaining why it is disabled.
    //
    // Read in its own scope: `delete_mod` takes the same lock.
    let (carried_notes, carried_favourite) = {
        match &replaced_mod_id {
            Some(old_id) => state
                .db
                .lock()
                .ok()
                .and_then(|conn| conn.data.mods.get(old_id).map(|m| (m.notes.clone(), m.favourite)))
                .unwrap_or((None, false)),
            None => (None, false),
        }
    };

    // The new files are valid — now it is safe to retire the old version.
    if let Some(old_id) = &replaced_mod_id {
        // Not undoable: the replacement is already on disk, so the old files
        // are superseded rather than lost.
        let _ = delete_mod(old_id.clone(), None, state.clone());
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

            if copy_instead_of_move {
                fs::copy(&file, &dest).map_err(|e| format!("Cannot copy {ext} file: {e}"))?;
            } else if fs::rename(&file, &dest).is_err() {
                // Different volume: fall back to copy.
                fs::copy(&file, &dest).map_err(|e| format!("Cannot move {ext} file: {e}"))?;
            }
        }

        pak_files.push(format!("{final_base}.pak"));
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
            notes: carried_notes,
            favourite: carried_favourite,
        };

        conn.data.mods.insert(mod_id.clone(), record);
        conn.save()?;
    }

    // Single owner of this event: whoever triggered the install — a button, a
    // dropped file or a finished download — gets the library refreshed without
    // having to ask for it.
    crate::downloader::emit_ui(app, "mod-installed", ());

    Ok(mod_id)
}

// ─── Variant selection ───────────────────────────────────────────

/// Path of `file` relative to the archive root, using forward slashes.
fn relative_dir(extract_dir: &Path, file: &Path) -> String {
    file.parent()
        .and_then(|p| p.strip_prefix(extract_dir).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// Leading path segments every folder shares, so labels read "COLORED VERSION"
/// instead of "Race_Leaderboard_v1.zip/COLORED VERSION".
fn common_prefix(dirs: &[String]) -> Vec<String> {
    let mut prefix: Vec<String> = match dirs.first() {
        Some(first) => first.split('/').map(str::to_string).collect(),
        None => return Vec::new(),
    };

    for dir in dirs.iter().skip(1) {
        let parts: Vec<&str> = dir.split('/').collect();
        let shared = prefix
            .iter()
            .zip(parts.iter())
            .take_while(|(a, b)| a.as_str() == **b)
            .count();
        prefix.truncate(shared);
    }

    // Never swallow a folder whole: it is the thing being chosen.
    if dirs.iter().any(|d| d.split('/').count() == prefix.len()) {
        prefix.pop();
    }
    prefix
}

/// Folders inside the archive that each hold a `.pak`.
///
/// Mod authors ship alternatives as sibling folders ("COLORED VERSION",
/// "WHITE VERSION"), and the files inside usually have *different* names, so a
/// name clash is the wrong signal — installing them all is what breaks the
/// game. Two or more folders holding a `.pak` is the reliable one.
///
/// Returns an empty list when there is nothing to choose.
fn detect_variants(
    extract_dir: &Path,
    groups: &HashMap<String, Vec<PathBuf>>,
) -> Vec<InstallVariant> {
    let mut by_dir: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    let mut dirs_with_pak: std::collections::BTreeSet<String> = Default::default();
    let mut every_file: Vec<String> = Vec::new();

    for files in groups.values() {
        for file in files {
            let dir = relative_dir(extract_dir, file);
            let name = file.file_name().unwrap_or_default().to_string_lossy().to_string();
            if has_ext(file, "pak") {
                dirs_with_pak.insert(dir.clone());
            }
            every_file.push(name.clone());
            by_dir.entry(dir).or_default().push(name);
        }
    }

    every_file.sort();
    every_file.dedup();

    let mut variants: Vec<InstallVariant> = if dirs_with_pak.len() >= 2 {
        // Alternatives in sibling folders — the common case.
        let dirs: Vec<String> = dirs_with_pak.into_iter().collect();
        let prefix = common_prefix(&dirs);

        dirs.into_iter()
            .map(|dir| {
                let mut files = by_dir.remove(&dir).unwrap_or_default();
                files.sort();

                let label = dir.split('/').skip(prefix.len()).collect::<Vec<_>>().join("/");

                InstallVariant {
                    label: if label.is_empty() {
                        "Archive root".to_string()
                    } else {
                        label
                    },
                    id: format!("{VARIANT_DIR}{dir}"),
                    files,
                }
            })
            .collect()
    } else {
        // Alternatives dumped loose in one folder. Nothing about the layout
        // gives them away, but two files claiming the same pakchunk cannot
        // both win — that is the same clash the conflict detector reports
        // between installed mods, so it is a reliable signal here too.
        let contested = contested_groups(groups);
        if contested.len() < 2 {
            return Vec::new();
        }

        let mut alternatives: Vec<InstallVariant> = contested
            .iter()
            .map(|base| {
                let mut files: Vec<String> = groups
                    .get(base)
                    .map(|files| {
                        files
                            .iter()
                            .map(|f| f.file_name().unwrap_or_default().to_string_lossy().to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                files.sort();

                InstallVariant {
                    label: files.first().cloned().unwrap_or_else(|| base.clone()),
                    id: format!("{VARIANT_PAK}{base}"),
                    files,
                }
            })
            .collect();

        alternatives.sort_by(|a, b| a.label.cmp(&b.label));
        alternatives
    };

    // Sibling folders and same-chunk files are *usually* alternatives, but an
    // archive can also be one mod split into parts, and nothing distinguishes
    // the two. Offering "all" keeps the guess from ever losing files.
    variants.push(InstallVariant {
        id: VARIANT_ALL.to_string(),
        label: "Install everything".to_string(),
        files: every_file,
    });

    variants
}

/// Groups whose `.pak` claims a pakchunk another group also claims. Two mods
/// on the same chunk cannot both apply, so inside one archive they are
/// alternatives rather than parts.
fn contested_groups(groups: &HashMap<String, Vec<PathBuf>>) -> std::collections::BTreeSet<String> {
    let mut owners: HashMap<i64, Vec<String>> = HashMap::new();

    for (base, files) in groups {
        let names: Vec<String> = files
            .iter()
            .filter(|f| has_ext(f, "pak"))
            .map(|f| f.file_name().unwrap_or_default().to_string_lossy().to_string())
            .collect();

        for chunk in extract_pakchunks(&names) {
            owners.entry(chunk).or_default().push(base.clone());
        }
    }

    owners
        .into_values()
        .filter(|bases| bases.len() > 1)
        .flatten()
        .collect()
}

/// Narrow an extraction down to the variant the user picked.
fn select_variant(
    staging_dir: &Path,
    groups: HashMap<String, Vec<PathBuf>>,
    variant: &str,
) -> HashMap<String, Vec<PathBuf>> {
    if variant == VARIANT_ALL {
        return groups;
    }

    if let Some(dir) = variant.strip_prefix(VARIANT_DIR) {
        return groups
            .into_iter()
            .filter_map(|(base, files)| {
                let kept: Vec<PathBuf> = files
                    .into_iter()
                    .filter(|f| relative_dir(staging_dir, f) == dir)
                    .collect();
                (!kept.is_empty()).then_some((base, kept))
            })
            .collect();
    }

    if let Some(chosen) = variant.strip_prefix(VARIANT_PAK) {
        // Keep the chosen alternative plus everything that was never in
        // competition: those are shared parts, not options.
        let contested = contested_groups(&groups);
        return groups
            .into_iter()
            .filter(|(base, _)| base == chosen || !contested.contains(base))
            .collect();
    }

    groups
}

/// Finish a parked install with the folder the user picked.
#[tauri::command]
pub fn resolve_install_variant(
    staging_id: String,
    variant: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    crate::game_detector::ensure_game_closed()?;

    let pending = {
        let mut map = state
            .pending_installs
            .lock()
            .map_err(|_| "Install state is locked".to_string())?;
        map.remove(&staging_id)
            .ok_or("That install is no longer waiting for a choice.")?
    };

    let game_path = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.get_setting("game_path").unwrap_or_default()
    };
    let mods_dir = get_mods_dir(&game_path);

    // Re-scan rather than carrying paths around: the staging directory is the
    // single source of truth and cannot go stale.
    let mut all_groups: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for entry in WalkDir::new(&pending.staging_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if let Some(base) = base_of(name) {
            all_groups.entry(base).or_default().push(path.to_path_buf());
        }
    }

    let groups = select_variant(&pending.staging_dir, all_groups, &variant);

    if !groups.values().any(|files| files.iter().any(|f| has_ext(f, "pak"))) {
        cleanup_pending(&pending);
        return Err("That option does not contain any .pak files.".to_string());
    }

    let replaced = pending.source_url.as_ref().and_then(|surl| {
        let conn = state.db.lock().ok()?;
        conn.data
            .mods
            .values()
            .find(|m| m.source_url.as_deref() == Some(surl.as_str()))
            .map(|m| (m.id.clone(), m.load_order))
    });

    let result = install_groups(
        groups,
        false,
        &mods_dir,
        pending.mod_name.clone(),
        pending.source_url.clone(),
        replaced,
        state,
        &app,
    );

    match result {
        Ok(mod_id) => {
            if let Some(archive) = &pending.archive_path {
                crate::downloader::store_archive(&app, archive);
            }
            cleanup_pending(&pending);
            crate::downloader::finish_pending_job(&app, &pending, None);
            Ok(mod_id)
        }
        Err(e) => {
            cleanup_pending(&pending);
            crate::downloader::finish_pending_job(&app, &pending, Some(e.clone()));
            Err(e)
        }
    }
}

/// Drop a parked install without installing anything.
#[tauri::command]
pub fn cancel_pending_install(
    staging_id: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let pending = {
        let mut map = state
            .pending_installs
            .lock()
            .map_err(|_| "Install state is locked".to_string())?;
        map.remove(&staging_id)
    };

    if let Some(pending) = pending {
        cleanup_pending(&pending);
        crate::downloader::finish_pending_job(&app, &pending, Some("Install canceled".to_string()));
    }
    Ok(())
}

fn cleanup_pending(pending: &PendingInstall) {
    let _ = fs::remove_dir_all(&pending.staging_dir);
    if let Some(dir) = &pending.archive_dir {
        let _ = fs::remove_dir_all(dir);
    }
}

/// Toggle a mod on or off by adding/removing the `.disabled` marker.
#[tauri::command]
pub fn toggle_mod(mod_id: String, enabled: bool, state: State<AppState>) -> Result<(), String> {
    crate::game_detector::ensure_game_closed()?;

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
///
/// With `undoable`, the files are moved into [`trash_dir`] instead of being
/// unlinked, and the record is written beside them so [`restore_mod`] can put
/// everything back. Uninstalling is the one destructive thing this app does to
/// a folder the user curates by hand, and "click the button twice" is a poor
/// substitute for being able to change your mind.
///
/// It is deliberately *not* undoable when called internally to retire the old
/// copy of a mod that is being updated: those files have already been replaced,
/// so keeping them would only leave junk behind.
#[tauri::command]
pub fn delete_mod(
    mod_id: String,
    undoable: Option<bool>,
    state: State<AppState>,
) -> Result<(), String> {
    crate::game_detector::ensure_game_closed()?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let game_path = conn.get_setting("game_path").unwrap_or_default();

    if let Some(mod_record) = conn.data.mods.remove(&mod_id) {
        if !game_path.is_empty() {
            let active_dir = get_mods_dir(&game_path);
            let on_disk = read_mod_files(&active_dir);
            let bin = undoable.unwrap_or(false).then(|| trash_dir(&active_dir, &mod_id));

            if let Some(bin) = &bin {
                fs::create_dir_all(bin).map_err(|e| format!("Cannot prepare undo: {e}"))?;
                let manifest = serde_json::to_string(&mod_record).map_err(|e| e.to_string())?;
                fs::write(bin.join(TRASH_MANIFEST), manifest)
                    .map_err(|e| format!("Cannot prepare undo: {e}"))?;
            }

            for pak in &mod_record.installed_filenames {
                let Some(base) = base_of(pak) else { continue };
                for file in on_disk.iter().filter(|f| f.base == base) {
                    match &bin {
                        // Renamed on the way in, so a recursive scan by the
                        // game can never pick a "removed" mod back up: nothing
                        // in here ends in .pak any more. Same trick as
                        // .disabled, for the same reason.
                        Some(bin) => {
                            let name = file.path.file_name().unwrap_or_default().to_string_lossy();
                            let _ = fs::rename(&file.path, bin.join(format!("{name}{TRASH_SUFFIX}")));
                        }
                        None => {
                            let _ = fs::remove_file(&file.path);
                        }
                    }
                }
            }
        }
        conn.save()?;
    }

    Ok(())
}

/// Put a mod deleted with `undoable` back exactly where it was.
///
/// The load order is restored from the record, but not re-applied to the other
/// mods: a restore is meant to look like the delete never happened, and
/// renumbering the whole folder would be a second surprise.
#[tauri::command]
pub fn restore_mod(mod_id: String, state: State<AppState>) -> Result<(), String> {
    crate::game_detector::ensure_game_closed()?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let game_path = conn
        .get_setting("game_path")
        .filter(|p| !p.trim().is_empty())
        .ok_or("Game path is not configured")?;

    let active_dir = get_mods_dir(&game_path);
    let bin = trash_dir(&active_dir, &mod_id);

    let manifest = fs::read_to_string(bin.join(TRASH_MANIFEST))
        .map_err(|_| "That mod can no longer be restored".to_string())?;
    let record: ModRecord =
        serde_json::from_str(&manifest).map_err(|e| format!("Cannot read the undo record: {e}"))?;

    for entry in fs::read_dir(&bin).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let Some(original) = name.strip_suffix(TRASH_SUFFIX) else {
            continue; // the manifest itself
        };
        fs::rename(&path, active_dir.join(original))
            .map_err(|e| format!("Cannot restore {original}: {e}"))?;
    }

    conn.data.mods.insert(mod_id, record);
    conn.save()?;

    let _ = fs::remove_dir_all(&bin);
    Ok(())
}

/// Drop everything waiting in the undo bin. Called at startup, because undo is
/// a second thought within a session — not a recycle bin that grows forever
/// inside the game folder.
pub fn empty_trash(game_path: &str) {
    if game_path.trim().is_empty() {
        return;
    }
    let _ = fs::remove_dir_all(get_mods_dir(game_path).join(TRASH_ROOT));
}

/// Undo storage sits *inside* `~mods` on purpose: a move within one folder is
/// instant and cannot fail because the game is on a different drive from
/// `%APPDATA%`, which a copy to the app data folder would.
fn trash_dir(active_dir: &Path, mod_id: &str) -> PathBuf {
    active_dir.join(TRASH_ROOT).join(mod_id)
}

/// Save the user's note for a mod.
///
/// No game-closed guard: this touches only `mods.json`, never a file the game
/// has open. The guard exists for operations that rename `.pak` files, and
/// applying it here would block note-taking for no reason at all.
#[tauri::command]
pub fn set_mod_notes(mod_id: String, notes: String, state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let record = conn
        .data
        .mods
        .get_mut(&mod_id)
        .ok_or("That mod is no longer installed")?;

    let trimmed = notes.trim();
    record.notes = (!trimmed.is_empty()).then(|| trimmed.to_string());
    conn.save()
}

/// Replace a mod's tags.
///
/// The field has existed on `ModRecord` since the first release and was always
/// written empty — this is what finally gives it a meaning. Normalised on the
/// way in (trimmed, de-duplicated case-insensitively, capped) so the filter and
/// the autocomplete never have to guess whether "Livery" and "livery" are the
/// same tag. They are.
#[tauri::command]
pub fn set_mod_tags(
    mod_id: String,
    tags: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let cleaned = normalise_tags(tags);

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let record = conn
        .data
        .mods
        .get_mut(&mod_id)
        .ok_or("That mod is no longer installed")?;

    record.tags = cleaned.clone();
    conn.save()?;
    Ok(cleaned)
}

/// Every tag in use, for the filter row and the autocomplete.
#[tauri::command]
pub fn list_tags(state: State<AppState>) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut seen: Vec<String> = Vec::new();
    for record in conn.data.mods.values() {
        for tag in &record.tags {
            if !seen.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                seen.push(tag.clone());
            }
        }
    }
    seen.sort_by_key(|t| t.to_lowercase());
    Ok(seen)
}

/// Longest a single tag may be. Long enough for "endurance liveries", short
/// enough that a tag stays a label rather than becoming a second notes field.
const MAX_TAG_LEN: usize = 24;
/// Cap per mod, so the row never turns into a wall of chips.
const MAX_TAGS: usize = 8;

fn normalise_tags(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        let clipped: String = trimmed.chars().take(MAX_TAG_LEN).collect();
        if out.iter().any(|t: &String| t.eq_ignore_ascii_case(&clipped)) {
            continue;
        }
        out.push(clipped);
        if out.len() >= MAX_TAGS {
            break;
        }
    }
    out
}

/// Pin or unpin a mod.
#[tauri::command]
pub fn set_mod_favourite(
    mod_id: String,
    favourite: bool,
    state: State<AppState>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let record = conn
        .data
        .mods
        .get_mut(&mod_id)
        .ok_or("That mod is no longer installed")?;

    record.favourite = favourite;
    conn.save()
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
    crate::game_detector::ensure_game_closed()?;

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

/// Turn "how many of this mod's file groups are on disk" into a verdict.
///
/// Pure, and tested, because the interesting cases are the ones that must
/// *not* raise an alarm: with no game folder configured there is nothing to
/// compare against, and a record that names no files cannot be missing them.
/// Getting either wrong would paint a healthy library red.
fn integrity_from_presence(present: usize, expected: usize, has_game_path: bool) -> ModIntegrity {
    if !has_game_path || expected == 0 {
        return ModIntegrity::Ok;
    }
    if present == 0 {
        return ModIntegrity::Missing;
    }
    if present < expected {
        return ModIntegrity::Incomplete;
    }
    ModIntegrity::Ok
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

    #[test]
    fn tags_are_normalised_so_the_filter_can_trust_them() {
        let tags = normalise_tags(vec![
            "  Livery ".into(),
            "livery".into(), // same tag in another case
            "".into(),       // nothing at all
            "   ".into(),
            "a".repeat(40),  // longer than the cap
        ]);

        // "Livery" and the over-long one survive; the case-duplicate and the
        // two blanks do not.
        assert_eq!(tags.len(), 2, "blank entries and the duplicate are dropped");
        assert_eq!(tags[0], "Livery", "the first spelling wins, trimmed");
        assert_eq!(tags[1].chars().count(), MAX_TAG_LEN, "clipped, not rejected");

        let many = normalise_tags((0..20).map(|i| format!("tag{i}")).collect());
        assert_eq!(many.len(), MAX_TAGS, "capped per mod");
    }

    #[test]
    fn integrity_only_alarms_when_it_can_actually_tell() {
        // Nothing configured: silence, not a library painted red.
        assert_eq!(integrity_from_presence(0, 3, false), ModIntegrity::Ok);
        // A record naming no files cannot be missing any.
        assert_eq!(integrity_from_presence(0, 0, true), ModIntegrity::Ok);

        assert_eq!(integrity_from_presence(0, 3, true), ModIntegrity::Missing);
        assert_eq!(integrity_from_presence(1, 3, true), ModIntegrity::Incomplete);
        assert_eq!(integrity_from_presence(3, 3, true), ModIntegrity::Ok);
    }

    /// The undo bin lives inside `~mods`, so the thing that must never happen
    /// is a "removed" mod still counting as installed — or, worse, still being
    /// loadable. Two guards, and this asserts both: the bin is a directory so
    /// the top-level scan skips it, and every file in it is renamed out of
    /// `.pak` on the way in.
    #[test]
    fn the_undo_bin_is_invisible_to_the_mods_scan() {
        let mods_dir = std::env::temp_dir().join(format!("f1m24-trash-{}", Uuid::new_v4()));
        let bin = trash_dir(&mods_dir, "some-mod-id");
        fs::create_dir_all(&bin).unwrap();

        fs::write(mods_dir.join("pakchunk9-WindowsNoEditor.pak"), b"live").unwrap();
        fs::write(
            bin.join(format!("pakchunk8-WindowsNoEditor.pak{TRASH_SUFFIX}")),
            b"deleted",
        )
        .unwrap();
        fs::write(bin.join(TRASH_MANIFEST), b"{}").unwrap();

        let found = read_mod_files(&mods_dir);
        assert_eq!(found.len(), 1, "only the live mod is installed");
        assert_eq!(found[0].base, "pakchunk9-WindowsNoEditor");

        // And the trashed name no longer ends in a loadable extension.
        let trashed = format!("pakchunk8-WindowsNoEditor.pak{TRASH_SUFFIX}");
        assert!(base_of(&trashed).is_none());
        assert_eq!(
            trashed.strip_suffix(TRASH_SUFFIX).unwrap(),
            "pakchunk8-WindowsNoEditor.pak",
            "a restore has to recover the exact original name"
        );

        let _ = fs::remove_dir_all(&mods_dir);
    }

    // ─── Variant detection ───────────────────────────────────────

    /// Build a staging folder with the given relative files, then group it the
    /// same way an install does.
    fn staged(files: &[&str]) -> (PathBuf, HashMap<String, Vec<PathBuf>>) {
        let dir = std::env::temp_dir().join(format!("f1m24-variants-{}", Uuid::new_v4()));
        for rel in files {
            let path = dir.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"x").unwrap();
        }

        let mut groups: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if let Some(base) = base_of(&name) {
                groups.entry(base).or_default().push(path.to_path_buf());
            }
        }
        (dir, groups)
    }

    #[test]
    fn install_outcome_reaches_the_ui_in_camel_case() {
        let json = serde_json::to_string(&InstallOutcome::NeedsVariant {
            staging_id: "abc".into(),
            variants: Vec::new(),
        })
        .unwrap();

        // The picker reads outcome.stagingId. Enum-level rename_all does not
        // touch fields inside variants, which broke this exact call once.
        assert!(json.contains(r#""kind":"needsVariant""#), "got {json}");
        assert!(json.contains(r#""stagingId""#), "got {json}");
        assert!(!json.contains("staging_id"), "got {json}");

        let installed =
            serde_json::to_string(&InstallOutcome::Installed { mod_id: "x".into() }).unwrap();
        assert!(installed.contains(r#""modId""#), "got {installed}");
    }

    fn labels(variants: &[InstallVariant]) -> Vec<&str> {
        variants.iter().map(|v| v.label.as_str()).collect()
    }

    #[test]
    fn offers_a_choice_when_folders_hold_the_same_file() {
        let (dir, groups) = staged(&["Option A/pakchunk50.pak", "Option B/pakchunk50.pak"]);
        let variants = detect_variants(&dir, &groups);

        assert_eq!(labels(&variants), vec!["Option A", "Option B", "Install everything"]);
        assert_eq!(variants[0].files, vec!["pakchunk50.pak"]);
        assert_eq!(variants.last().unwrap().id, VARIANT_ALL);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn offers_a_choice_when_folders_hold_differently_named_files() {
        // The shape mod authors actually ship: sibling folders whose .pak files
        // have different names. Installing them all is what breaks the game, so
        // a name clash is the wrong thing to look for.
        let (dir, groups) = staged(&[
            "Race_Leaderboard_v1/COLORED VERSION/UI_Leaderboard_Color_P.pak",
            "Race_Leaderboard_v1/WHITE VERSION/UI_Leaderboard_White_P.pak",
            "Race_Leaderboard_v1/README.TXT",
        ]);
        let variants = detect_variants(&dir, &groups);

        // The wrapper folder every option shares is stripped from the labels.
        assert_eq!(
            labels(&variants),
            vec!["COLORED VERSION", "WHITE VERSION", "Install everything"]
        );
        assert!(variants[0].id.ends_with("COLORED VERSION"), "got {}", variants[0].id);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn separate_folders_can_still_be_installed_together() {
        // Two unrelated mods in one archive look identical to two alternatives,
        // so the guess must never be destructive: "all" is always on offer.
        let (dir, groups) = staged(&["Cars/pakchunk50.pak", "Tracks/pakchunk60.pak"]);
        let variants = detect_variants(&dir, &groups);

        assert_eq!(labels(&variants), vec!["Cars", "Tracks", "Install everything"]);
        let all = variants.last().unwrap();
        assert_eq!(all.files, vec!["pakchunk50.pak", "pakchunk60.pak"]);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn offers_a_choice_for_loose_files_on_the_same_pakchunk() {
        // No folders to go by, but two files claiming pakchunk 50 cannot both
        // apply, so they are alternatives however they are laid out.
        let (dir, groups) = staged(&[
            "pakchunk50-Red_P.pak",
            "pakchunk50-Blue_P.pak",
            "pakchunk60-Shared_P.pak",
        ]);
        let variants = detect_variants(&dir, &groups);

        assert_eq!(
            labels(&variants),
            vec!["pakchunk50-Blue_P.pak", "pakchunk50-Red_P.pak", "Install everything"]
        );

        // Picking one keeps the uncontested file: it is a part, not an option.
        let chosen = select_variant(&dir, groups, &variants[0].id);
        let mut kept: Vec<String> = chosen
            .values()
            .flatten()
            .map(|f| f.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        kept.sort();
        assert_eq!(kept, vec!["pakchunk50-Blue_P.pak", "pakchunk60-Shared_P.pak"]);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parts_on_different_pakchunks_are_not_a_choice() {
        // A mod split across chunks installs whole, without asking.
        let (dir, groups) = staged(&["Mod/pakchunk50-A_P.pak", "Mod/pakchunk60-B_P.pak"]);
        assert!(detect_variants(&dir, &groups).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_single_folder_mod_is_not_a_choice() {
        // What most downloads look like: one folder, one pak.
        let (dir, groups) = staged(&["extendedstandings_0.2/pakchunk0-extended_2_P.pak"]);
        assert!(detect_variants(&dir, &groups).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_multi_part_mod_is_not_a_choice() {
        // .pak + .ucas + .utoc belong together: asking the user to pick one
        // would break the mod.
        let (dir, groups) = staged(&[
            "pakchunk50.pak",
            "pakchunk50.ucas",
            "pakchunk50.utoc",
            "pakchunk51.pak",
        ]);
        assert!(detect_variants(&dir, &groups).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_clash_at_the_archive_root_is_labelled() {
        let (dir, groups) = staged(&["pakchunk50.pak", "Alt/pakchunk50.pak"]);
        let variants = detect_variants(&dir, &groups);

        let found = labels(&variants);
        assert!(found.contains(&"Archive root"), "got {found:?}");
        assert!(found.contains(&"Alt"), "got {found:?}");

        fs::remove_dir_all(&dir).ok();
    }
}
