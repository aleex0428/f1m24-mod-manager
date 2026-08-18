// ─── profiles.rs — Named sets of active mods ────────────────────
//
// A profile is a reproducible state: "Season 2026" is eighteen specific mods,
// enabled, in a specific order. Switching to it should leave the game folder
// exactly as it was the last time that profile was applied — which is why a
// profile stores the **complete** list of what to enable rather than a set of
// additions. Anything it does not name is turned off.
//
// That choice is what makes "Clean (no mods)" expressible at all, and it is
// also the one thing that will surprise people: a mod installed after a profile
// was saved is not in it, so applying that profile disables the new mod. The UI
// says so before the first apply.

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::db::Profile;
use crate::game_detector::ensure_game_closed;
use crate::AppState;

/// Setting key holding the id of the profile last applied.
const ACTIVE_PROFILE: &str = "active_profile";

/// What applying a profile actually did.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub enabled: usize,
    pub disabled: usize,
    /// Mods the profile names that are no longer installed. Reported rather
    /// than treated as an error: a profile outliving one of its mods is normal.
    pub missing: usize,
    /// True when the load order already matched and no files were renamed.
    pub order_unchanged: bool,
}

#[tauri::command]
pub fn list_profiles(state: State<AppState>) -> Result<Vec<Profile>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(conn.data.profiles.clone())
}

/// Id of the profile last applied, if it still exists.
#[tauri::command]
pub fn get_active_profile(state: State<AppState>) -> Result<Option<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let active = conn.get_setting(ACTIVE_PROFILE);
    Ok(active.filter(|id| conn.data.profiles.iter().any(|p| &p.id == id)))
}

/// Capture the library exactly as it is now under a new name.
#[tauri::command]
pub fn save_profile(name: String, state: State<AppState>) -> Result<Profile, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Give the profile a name".into());
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    if conn.data.profiles.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
        return Err(format!("A profile called \"{name}\" already exists"));
    }

    let mut mods: Vec<_> = conn.data.mods.values().collect();
    mods.sort_by_key(|m| m.load_order);

    let profile = Profile {
        id: Uuid::new_v4().to_string(),
        name,
        enabled_mod_ids: mods.iter().filter(|m| m.enabled).map(|m| m.id.clone()).collect(),
        order: mods.iter().map(|m| m.id.clone()).collect(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    log::info!(
        "profile saved: {} ({} of {} mods enabled)",
        profile.name,
        profile.enabled_mod_ids.len(),
        profile.order.len()
    );

    conn.data.profiles.push(profile.clone());
    let id = profile.id.clone();
    conn.set_setting(ACTIVE_PROFILE.to_string(), id)?;
    conn.save()?;
    Ok(profile)
}

/// Overwrite a profile with the current state of the library.
#[tauri::command]
pub fn update_profile(id: String, state: State<AppState>) -> Result<Profile, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut mods: Vec<_> = conn.data.mods.values().collect();
    mods.sort_by_key(|m| m.load_order);
    let enabled: Vec<String> = mods.iter().filter(|m| m.enabled).map(|m| m.id.clone()).collect();
    let order: Vec<String> = mods.iter().map(|m| m.id.clone()).collect();

    let profile = conn
        .data
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("That profile no longer exists")?;

    profile.enabled_mod_ids = enabled;
    profile.order = order;
    let updated = profile.clone();

    conn.save()?;
    Ok(updated)
}

#[tauri::command]
pub fn rename_profile(id: String, name: String, state: State<AppState>) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Give the profile a name".into());
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    if conn
        .data
        .profiles
        .iter()
        .any(|p| p.id != id && p.name.eq_ignore_ascii_case(&name))
    {
        return Err(format!("A profile called \"{name}\" already exists"));
    }

    let profile = conn
        .data
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("That profile no longer exists")?;
    profile.name = name;
    conn.save()
}

#[tauri::command]
pub fn delete_profile(id: String, state: State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.data.profiles.retain(|p| p.id != id);

    if conn.get_setting(ACTIVE_PROFILE).as_deref() == Some(id.as_str()) {
        conn.set_setting(ACTIVE_PROFILE.to_string(), String::new())?;
    }
    conn.save()
}

/// Put the library into the state the profile describes.
#[tauri::command]
pub fn apply_profile(id: String, state: State<AppState>) -> Result<ApplyReport, String> {
    // Applying a profile is the single operation that touches the most files at
    // once, so it is the worst one to attempt against a running game.
    ensure_game_closed()?;

    let (profile, installed_ids) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let profile = conn
            .data
            .profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or("That profile no longer exists")?;
        let installed: Vec<String> = conn.data.mods.keys().cloned().collect();
        (profile, installed)
    };

    let wanted: std::collections::HashSet<&String> = profile.enabled_mod_ids.iter().collect();
    let missing = profile
        .enabled_mod_ids
        .iter()
        .filter(|id| !installed_ids.contains(id))
        .count();

    // ── Enable / disable ────────────────────────────────────────
    let mut report = ApplyReport { missing, ..Default::default() };

    for mod_id in &installed_ids {
        let should_be_on = wanted.contains(mod_id);
        let currently_on = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            conn.data.mods.get(mod_id).map(|m| m.enabled).unwrap_or(false)
        };
        if should_be_on == currently_on {
            continue;
        }

        crate::mod_manager::toggle_mod(mod_id.clone(), should_be_on, state.clone())?;
        if should_be_on {
            report.enabled += 1;
        } else {
            report.disabled += 1;
        }
    }

    // ── Load order ──────────────────────────────────────────────
    // The profile's order, minus anything uninstalled since, plus anything
    // installed since — appended at the end so a new mod never silently
    // outranks the arrangement the user saved.
    let mut order: Vec<String> = profile
        .order
        .iter()
        .filter(|id| installed_ids.contains(id))
        .cloned()
        .collect();
    for mod_id in &installed_ids {
        if !order.contains(mod_id) {
            order.push(mod_id.clone());
        }
    }

    let current: Vec<String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut mods: Vec<_> = conn.data.mods.values().collect();
        mods.sort_by_key(|m| m.load_order);
        mods.iter().map(|m| m.id.clone()).collect()
    };

    // `apply_load_order` renames every mod file to carry its new priority.
    // Doing that when the order already matches is pure disk churn on a folder
    // that can hold hundreds of files.
    report.order_unchanged = order == current;
    if !report.order_unchanged {
        crate::mod_manager::apply_load_order(order, state.clone())?;
    }

    {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.set_setting(ACTIVE_PROFILE.to_string(), id)?;
        conn.save()?;
    }

    log::info!(
        "profile applied: {} (+{} -{}, {} missing, order {})",
        profile.name,
        report.enabled,
        report.disabled,
        report.missing,
        if report.order_unchanged { "unchanged" } else { "rewritten" }
    );

    Ok(report)
}

// ─── Sharing ─────────────────────────────────────────────────────
//
// The exported file carries **references, not files**: each mod's Overtake
// page, its version and its place in the order. Bundling the `.pak` files would
// mean redistributing other people's work without asking, and routing people
// around the download counts their authors are judged by. A shared profile is a
// recommendation; whoever accepts it downloads from the author.

/// One mod inside an exported profile.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SharedMod {
    pub title: String,
    /// Overtake page. Empty for a mod installed from a local file, which
    /// therefore cannot be resolved on the other end — reported, not silently
    /// dropped.
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub version: Option<String>,
    pub enabled: bool,
}

/// The file format. Versioned from day one so a future change has somewhere to
/// announce itself instead of just failing to parse.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedProfile {
    #[serde(default = "default_format")]
    pub format: u32,
    pub name: String,
    #[serde(default)]
    pub exported_at: String,
    pub mods: Vec<SharedMod>,
}

fn default_format() -> u32 {
    1
}

/// Current format number.
const FORMAT: u32 = 1;

/// What an import would mean, worked out before anything is written.
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub name: String,
    /// Mods in the file that are already installed here.
    pub already_installed: Vec<String>,
    /// Mods that can be fetched, with the page to fetch them from.
    pub downloadable: Vec<SharedMod>,
    /// Mods with no usable Overtake link — installed from a local file by
    /// whoever exported it, so there is nothing to point at.
    pub unavailable: Vec<String>,
}

/// Turn a profile into the shareable structure.
#[tauri::command]
pub fn export_profile(id: String, state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let profile = conn
        .data
        .profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or("That profile no longer exists")?;

    let enabled: std::collections::HashSet<&String> = profile.enabled_mod_ids.iter().collect();

    // Walk the profile's own order so the file preserves it. Mods it names that
    // are no longer installed simply cannot be described.
    let mods: Vec<SharedMod> = profile
        .order
        .iter()
        .filter_map(|mod_id| conn.data.mods.get(mod_id))
        .map(|m| SharedMod {
            title: m.name.clone(),
            url: m.source_url.clone().unwrap_or_default(),
            version: m.version.clone(),
            enabled: enabled.contains(&m.id),
        })
        .collect();

    let shared = SharedProfile {
        format: FORMAT,
        name: profile.name.clone(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        mods,
    };

    log::info!("profile exported: {} ({} mods)", shared.name, shared.mods.len());
    serde_json::to_string_pretty(&shared).map_err(|e| e.to_string())
}

/// Read a shared profile and say what importing it would involve.
///
/// Read-only on purpose: opening a file somebody sent you must not rearrange
/// your mod folder. It reports; the user decides what happens next.
#[tauri::command]
pub fn preview_shared_profile(
    contents: String,
    state: State<AppState>,
) -> Result<ImportPreview, String> {
    let shared: SharedProfile = serde_json::from_str(&contents)
        .map_err(|_| "That file is not a mod profile this app can read".to_string())?;

    if shared.format > FORMAT {
        return Err(
            "That profile was made by a newer version of the app. Update and try again.".into(),
        );
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let installed: std::collections::HashSet<String> = conn
        .data
        .mods
        .values()
        .filter_map(|m| m.source_url.as_ref())
        .map(|u| normalise_url(u))
        .collect();

    let mut preview = ImportPreview { name: shared.name, ..Default::default() };

    for entry in shared.mods {
        if entry.url.trim().is_empty() {
            preview.unavailable.push(entry.title);
        } else if installed.contains(&normalise_url(&entry.url)) {
            preview.already_installed.push(entry.title);
        } else {
            preview.downloadable.push(entry);
        }
    }

    Ok(preview)
}

/// Save a shared profile locally, matching its mods to what is installed.
/// Nothing is downloaded, enabled or reordered here.
#[tauri::command]
pub fn import_shared_profile(contents: String, state: State<AppState>) -> Result<Profile, String> {
    let shared: SharedProfile = serde_json::from_str(&contents)
        .map_err(|_| "That file is not a mod profile this app can read".to_string())?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    // Matched by Overtake page: mod ids are local to each installation, so the
    // URL is the only thing two machines can agree on.
    let by_url: std::collections::HashMap<String, String> = conn
        .data
        .mods
        .values()
        .filter_map(|m| m.source_url.as_ref().map(|u| (normalise_url(u), m.id.clone())))
        .collect();

    let mut order = Vec::new();
    let mut enabled = Vec::new();
    for entry in &shared.mods {
        if let Some(local_id) = by_url.get(&normalise_url(&entry.url)) {
            order.push(local_id.clone());
            if entry.enabled {
                enabled.push(local_id.clone());
            }
        }
    }

    // A duplicate name would be indistinguishable in the picker.
    let mut name = shared.name.trim().to_string();
    if name.is_empty() {
        name = "Imported profile".into();
    }
    let mut candidate = name.clone();
    let mut suffix = 2;
    while conn.data.profiles.iter().any(|p| p.name.eq_ignore_ascii_case(&candidate)) {
        candidate = format!("{name} ({suffix})");
        suffix += 1;
    }

    let profile = Profile {
        id: Uuid::new_v4().to_string(),
        name: candidate,
        enabled_mod_ids: enabled,
        order,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    log::info!(
        "profile imported: {} ({} of {} mods matched locally)",
        profile.name,
        profile.order.len(),
        shared.mods.len()
    );

    conn.data.profiles.push(profile.clone());
    conn.save()?;
    Ok(profile)
}

/// Extension for a shared profile. Distinct enough that Windows will not steal
/// it from another app, and obvious enough to recognise in a Downloads folder.
const PROFILE_EXT: &str = "f1mprofile";

/// Ask where to put the file, then write it.
///
/// The dialog runs in Rust like every other one in this app, so the frontend
/// keeps needing no filesystem permission at all — see the capability file,
/// which says exactly that.
#[tauri::command]
pub async fn export_profile_dialog(
    id: String,
    name: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let json = export_profile(id, state)?;

    // A blocking recv() would stall a runtime worker for as long as the dialog
    // is open, so the result is awaited.
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();

    let suggested = format!("{}.{PROFILE_EXT}", slugify(&name));
    app.dialog()
        .file()
        .set_file_name(&suggested)
        .add_filter("Mod profile", &[PROFILE_EXT])
        .save_file(move |path| {
            let _ = tx.send(path.and_then(|p| p.into_path().ok()));
        });

    let selected = rx.await.map_err(|_| "Dialog cancelled".to_string())?;
    let path = selected.ok_or_else(|| "No file selected".to_string())?;

    std::fs::write(&path, json).map_err(|e| format!("Could not write the file: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Ask for a file and hand back its contents, unparsed.
///
/// Reading is all this does. Whether anything is imported is decided later, by
/// the user, after seeing the preview.
#[tauri::command]
pub async fn pick_profile_file(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();

    app.dialog()
        .file()
        .add_filter("Mod profile", &[PROFILE_EXT, "json"])
        .pick_file(move |path| {
            let _ = tx.send(path.and_then(|p| p.into_path().ok()));
        });

    let selected = rx.await.map_err(|_| "Dialog cancelled".to_string())?;
    let path = selected.ok_or_else(|| "No file selected".to_string())?;

    std::fs::read_to_string(&path).map_err(|e| format!("Could not read the file: {e}"))
}

/// A profile name turned into something safe to put on a filesystem.
fn slugify(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();

    // Collapse runs of separators and trim them off the ends, so "Season 2026!"
    // becomes "season-2026" rather than "season-2026-".
    let collapsed = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if collapsed.is_empty() { "profile".to_string() } else { collapsed }
}

/// Compare Overtake pages the way the rest of the app does: a trailing slash
/// and a `/download` suffix are noise, and case never matters.
fn normalise_url(url: &str) -> String {
    url.trim()
        .trim_end_matches('/')
        .trim_end_matches("/download")
        .trim_end_matches('/')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    /// Rebuild the order a profile should produce, given what is installed now.
    ///
    /// Extracted so the two rules that are easy to get wrong can be pinned:
    /// uninstalled mods drop out rather than leaving a hole, and mods installed
    /// since the profile was saved go to the **end** — appending them anywhere
    /// else would let a brand-new mod quietly override a carefully built order.
    fn resolve_order(saved: &[&str], installed: &[&str]) -> Vec<String> {
        let mut order: Vec<String> = saved
            .iter()
            .filter(|id| installed.contains(id))
            .map(|id| id.to_string())
            .collect();
        for id in installed {
            if !order.iter().any(|existing| existing == id) {
                order.push(id.to_string());
            }
        }
        order
    }

    /// Matching an imported profile to a local library hangs entirely on this:
    /// mod ids differ between machines, so the Overtake page is the only shared
    /// identity. A mod written one way here and another way there would import
    /// as "not installed" and be queued for a download the user already has.
    #[test]
    fn a_profile_name_becomes_a_usable_filename() {
        assert_eq!(super::slugify("Season 2026"), "season-2026");
        assert_eq!(super::slugify("Season 2026!"), "season-2026", "no trailing separator");
        assert_eq!(super::slugify("  //  "), "profile", "never an empty filename");
        assert_eq!(super::slugify("Clásicos"), "clásicos", "letters survive, whatever the alphabet");
    }

    #[test]
    fn urls_compare_the_same_however_they_were_written() {
        let canonical = super::normalise_url("https://www.overtake.gg/downloads/f1-elite.85465/");

        assert_eq!(
            super::normalise_url("https://www.overtake.gg/downloads/f1-elite.85465"),
            canonical
        );
        assert_eq!(
            super::normalise_url("https://www.overtake.gg/downloads/f1-elite.85465/download"),
            canonical,
            "the queue stores the download form"
        );
        assert_eq!(
            super::normalise_url("  HTTPS://WWW.OVERTAKE.GG/downloads/F1-Elite.85465/  "),
            canonical
        );
    }

    #[test]
    fn dropped_mods_leave_no_hole_and_new_ones_go_last() {
        // "b" was uninstalled since; "d" was installed since.
        let order = resolve_order(&["a", "b", "c"], &["a", "c", "d"]);
        assert_eq!(order, vec!["a", "c", "d"]);
    }

    #[test]
    fn an_unchanged_library_keeps_its_exact_order() {
        let order = resolve_order(&["a", "b", "c"], &["c", "b", "a"]);
        assert_eq!(order, vec!["a", "b", "c"], "the profile decides, not the disk");
    }
}
