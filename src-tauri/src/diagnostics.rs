// ─── diagnostics.rs — Logs and the "what does your setup look like" report ──
//
// When something failed for a user there was nothing to ask them for. There is
// now a rotating log on disk and a one-click summary they can paste into a
// forum post or a bug report.
//
// **Nothing here may ever include a cookie, a session token or a page body.**
// The whole point is that this text gets pasted in public: `auth.rs` holds the
// Overtake session, and a diagnostic that leaked it would hand someone else the
// user's account. Session state is reported as a bare yes/no, and log calls
// elsewhere in the app must follow the same rule.

use tauri::{AppHandle, Manager, State};

use crate::{db, game_detector, AppState};

/// Where `tauri-plugin-log` writes. Kept in one place so the Settings button
/// and the log target cannot drift apart.
pub fn log_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_log_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("./logs"))
}

/// Reveal the folder holding the log files.
#[tauri::command]
pub fn open_log_folder(app: AppHandle) -> Result<(), String> {
    let dir = log_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create the log folder: {e}"))?;
    game_detector::open_in_explorer(&dir)
}

/// A short report describing this installation, for pasting into a bug report.
///
/// Facts only, and only facts the user can already see somewhere in the app.
#[tauri::command]
pub fn collect_diagnostics(app: AppHandle, state: State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let game_path = conn.get_setting("game_path").unwrap_or_default();
    let game_ok = !game_path.is_empty() && game_detector::is_valid_game_path(&game_path);

    let total = conn.data.mods.len();
    let enabled = conn.data.mods.values().filter(|m| m.enabled).count();
    let from_overtake = conn
        .data
        .mods
        .values()
        .filter(|m| m.source_url.as_ref().is_some_and(|u| !u.is_empty()))
        .count();

    let catalog = conn.data.mod_cache.len();
    let last_sync = conn.get_setting("catalog_last_sync").unwrap_or_else(|| "never".into());

    let mut report = String::new();
    report.push_str("F1M24 Mod Manager — diagnostics\n");
    report.push_str(&format!("app         {}\n", app.package_info().version));
    report.push_str(&format!("os          {}\n", std::env::consts::OS));
    report.push_str(&format!(
        "game path   {}\n",
        if game_path.is_empty() { "not set" } else { &game_path }
    ));
    report.push_str(&format!("game valid  {game_ok}\n"));
    report.push_str(&format!(
        "game running {}\n",
        crate::game_detector::is_game_running()
    ));
    report.push_str(&format!("mods        {total} installed, {enabled} enabled\n"));
    report.push_str(&format!("  from Overtake {from_overtake}, local {}\n", total - from_overtake));
    report.push_str(&format!("catalogue   {catalog} cached, last sync {last_sync}\n"));
    // Deliberately a boolean: the session itself never leaves the cookie jar.
    report.push_str(&format!(
        "overtake    {}\n",
        if conn.get_setting("is_logged_in").as_deref() == Some("true") {
            "linked"
        } else {
            "not linked"
        }
    ));
    report.push_str(&format!("log folder  {}\n", log_dir(&app).display()));

    Ok(report)
}

/// Absolute path of the log folder, for display in Settings.
#[tauri::command]
pub fn get_log_dir(app: AppHandle) -> String {
    log_dir(&app).to_string_lossy().to_string()
}

/// Record the app's own starting conditions, so the first lines of every log
/// already answer the questions a report would otherwise have to ask.
pub fn log_startup(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    log::info!("F1M24 Mod Manager {version} starting on {}", std::env::consts::OS);

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(conn) = state.db.lock() {
            let path = conn.get_setting("game_path").unwrap_or_default();
            log::info!(
                "library: {} mods, catalogue: {} entries, game path {}",
                conn.data.mods.len(),
                conn.data.mod_cache.len(),
                if path.is_empty() { "not set" } else { "set" }
            );
        }
    }
}

/// Marker so `db` stays used if the report is ever trimmed back.
#[allow(dead_code)]
type _Db = db::DbStore;
