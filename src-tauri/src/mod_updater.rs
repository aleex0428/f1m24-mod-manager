// ─── mod_updater.rs — Update detection ──────────────────────────
//
// Updates are resolved against the locally synced Overtake catalog instead of
// scraping each mod page: no Cloudflare round-trips, instant results, and it
// works offline right after a catalog sync.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAvailable {
    pub mod_id: String,
    pub mod_name: String,
    pub current_version: Option<String>,
    pub new_version: String,
    pub page_url: String,
    pub download_url: String,
    pub last_updated: String,
}

#[tauri::command]
pub fn check_for_updates(state: State<AppState>) -> Result<Vec<UpdateAvailable>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // Without a catalog there is nothing to compare against, and reporting
    // "everything is up to date" would be a lie.
    if conn.data.mod_cache.is_empty() {
        return Err("Sync the mod catalog first (Browse → Sync catalog).".to_string());
    }

    let mut updates = Vec::new();

    for m in conn.data.mods.values() {
        let Some(source_url) = m.source_url.as_ref().filter(|u| !u.is_empty()) else {
            continue;
        };
        let key = normalize_url(source_url);

        let Some(cached) = conn
            .data
            .mod_cache
            .values()
            .find(|c| normalize_url(&c.url) == key)
        else {
            continue;
        };

        let new_version = cached
            .version
            .clone()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| cached.last_updated.clone());
        if new_version.trim().is_empty() {
            continue;
        }

        let current = m.version.clone().unwrap_or_default();
        let is_newer = match current.trim() {
            // Never versioned locally: only flag it if the catalog moved on
            // after we installed it.
            "" => catalog_is_newer(&cached.last_updated, &m.installed_at),
            cur => normalize_version(cur) != normalize_version(&new_version),
        };

        if is_newer {
            updates.push(UpdateAvailable {
                mod_id: m.id.clone(),
                mod_name: m.name.clone(),
                current_version: m.version.clone(),
                new_version,
                page_url: cached.url.clone(),
                download_url: format!("{}/download", cached.url.trim_end_matches('/')),
                last_updated: cached.last_updated.clone(),
            });
        }
    }

    updates.sort_by(|a, b| a.mod_name.to_lowercase().cmp(&b.mod_name.to_lowercase()));
    Ok(updates)
}


// ─── Helpers ─────────────────────────────────────────────────────

fn normalize_url(url: &str) -> String {
    url.trim()
        .trim_end_matches('/')
        .trim_end_matches("/download")
        .trim_end_matches('/')
        .to_lowercase()
}

fn normalize_version(v: &str) -> String {
    v.trim().to_lowercase().trim_start_matches('v').trim().to_string()
}

/// Both values are ISO-ish dates ("2025-04-02" vs RFC3339), so a prefix
/// comparison on the date part is enough and never panics.
fn catalog_is_newer(catalog_date: &str, installed_at: &str) -> bool {
    let a = catalog_date.get(..10).unwrap_or_default();
    let b = installed_at.get(..10).unwrap_or_default();
    !a.is_empty() && !b.is_empty() && a > b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_dates_by_day() {
        assert!(catalog_is_newer("2025-06-02", "2025-06-01T10:00:00Z"));
        assert!(!catalog_is_newer("2025-06-01", "2025-06-01T10:00:00Z"));
        assert!(!catalog_is_newer("", "2025-06-01T10:00:00Z"));
    }

    #[test]
    fn normalizes_versions() {
        assert_eq!(normalize_version(" V1.2 "), "1.2");
    }
}
