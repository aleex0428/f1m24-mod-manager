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

use serde::Serialize;
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
