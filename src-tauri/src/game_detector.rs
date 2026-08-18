// ─── game_detector.rs — F1 Manager 24 path detection ───────────
//
// Fallback chain:
//   1. Windows registry (uninstall keys)
//   2. Steam VDF parser (AppID 2591280)
//   3. Epic Games manifests
//   4. Known hardcoded paths
//   5. Err("NOT_FOUND")

use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// F1 Manager 24 Steam AppID
const STEAM_APP_ID: &str = "2591280";

/// Well-known fallback paths
const KNOWN_PATHS: &[&str] = &[
    r"C:\Program Files\Steam\steamapps\common\F1 Manager 2024",
    r"C:\Program Files (x86)\Steam\steamapps\common\F1 Manager 2024",
    r"D:\Steam\steamapps\common\F1 Manager 2024",
    r"D:\SteamLibrary\steamapps\common\F1 Manager 2024",
    r"E:\Steam\steamapps\common\F1 Manager 2024",
    r"E:\SteamLibrary\steamapps\common\F1 Manager 2024",
    r"C:\Program Files\Steam\steamapps\common\F1 Manager 24",
    r"C:\Program Files (x86)\Steam\steamapps\common\F1 Manager 24",
    r"D:\Steam\steamapps\common\F1 Manager 24",
    r"D:\SteamLibrary\steamapps\common\F1 Manager 24",
];

/// The main executable to verify the install folder.
const GAME_EXE: &str = "F1Manager24.exe";

/// Attempt to detect the F1 Manager 24 installation path.
#[tauri::command]
pub fn detect_game_path() -> Result<String, String> {
    #[cfg(windows)]
    {
        // 1. Registry uninstall keys
        if let Some(path) = detect_via_registry() {
            return Ok(normalize_path(&path));
        }
        // 2. Steam VDF
        if let Some(path) = detect_via_steam_registry() {
            return Ok(normalize_path(&path));
        }
        // 3. Epic Games
        if let Some(path) = detect_via_epic() {
            return Ok(normalize_path(&path));
        }
    }

    // 4. Known paths — only trust a folder that really holds the executable.
    for known in KNOWN_PATHS {
        let p = PathBuf::from(known);
        if p.join(GAME_EXE).exists() {
            return Ok(normalize_path(known));
        }
    }

    Err("NOT_FOUND".into())
}

/// Open a native folder picker and validate the selection contains F1Manager24.exe.
#[tauri::command]
pub async fn select_game_path_dialog(
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    // A blocking recv() here would stall a runtime worker for as long as the
    // dialog stays open, so the result is awaited instead.
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app.dialog().file().pick_folder(move |folder_path| {
        let _ = tx.send(folder_path.map(|p| p.to_string()));
    });

    let selected = rx.await.map_err(|_| "Dialog cancelled".to_string())?;
    let path_str = selected.ok_or_else(|| "No folder selected".to_string())?;

    // Validate it contains the game executable or find the root
    let selected_path = PathBuf::from(&path_str);
    let mut current_dir = Some(selected_path.as_path());
    let mut found_root = None;

    while let Some(dir) = current_dir {
        if dir.join(GAME_EXE).exists() {
            found_root = Some(dir.to_path_buf());
            break;
        }
        current_dir = dir.parent();
    }

    if found_root.is_none() {
        return Err(format!(
            "That folder is not an F1 Manager 24 installation. Pick the root folder, the one that contains {GAME_EXE}."
        ));
    }
    
    let path_str = normalize_path(&found_root.unwrap().to_string_lossy());

    // Save to JSON
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.set_setting("game_path".to_string(), path_str.clone())?;

    Ok(path_str)
}

// ─── Windows registry detection ──────────────────────────────────

#[cfg(windows)]
fn detect_via_registry() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let uninstall_paths = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for uninstall_root in &uninstall_paths {
        if let Ok(uninstall) = hklm.open_subkey(uninstall_root) {
            for key_name in uninstall.enum_keys().flatten() {
                if let Ok(subkey) = uninstall.open_subkey(&key_name) {
                    let display_name: String =
                        subkey.get_value("DisplayName").unwrap_or_default();
                    if display_name.contains("F1 Manager 24") || display_name.contains("F1 Manager 2024") {
                        if let Ok(location) = subkey.get_value::<String, _>("InstallLocation") {
                            if !location.is_empty() {
                                let exe = PathBuf::from(&location).join(GAME_EXE);
                                if exe.exists() {
                                    return Some(location);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

// ─── Steam VDF detection ─────────────────────────────────────────

#[cfg(windows)]
fn detect_via_steam_registry() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // Try HKCU first (user Steam install), then HKLM (global)
    let steam_path: String = hkcu
        .open_subkey(r"Software\Valve\Steam")
        .and_then(|k| k.get_value("SteamPath"))
        .or_else(|_| {
            hklm.open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam")
                .and_then(|k| k.get_value("InstallPath"))
        })
        .or_else(|_| {
            hklm.open_subkey(r"SOFTWARE\Valve\Steam")
                .and_then(|k| k.get_value("InstallPath"))
        })
        .ok()?;

    // Check default library
    for folder_name in &["F1 Manager 2024", "F1 Manager 24"] {
        let default_lib = PathBuf::from(&steam_path)
            .join("steamapps")
            .join("common")
            .join(folder_name);
        if default_lib.join(GAME_EXE).exists() {
            return Some(default_lib.to_string_lossy().into_owned());
        }
    }

    // Parse libraryfolders.vdf for additional libraries
    let vdf_path = PathBuf::from(&steam_path)
        .join("steamapps")
        .join("libraryfolders.vdf");

    if let Ok(vdf_content) = std::fs::read_to_string(&vdf_path) {
        let mut current_path = String::new();

        for line in vdf_content.lines() {
            let trimmed = line.trim();

            if trimmed.starts_with("\"path\"") {
                let parts: Vec<&str> = trimmed.splitn(4, '"').collect();
                if parts.len() >= 4 {
                    current_path = parts[3].replace("\\\\", "\\");
                }
            }

            // Check if this library block contains our AppID
            if trimmed.starts_with(&format!("\"{}\"", STEAM_APP_ID)) && !current_path.is_empty() {
                for folder_name in &["F1 Manager 2024", "F1 Manager 24"] {
                    let candidate = PathBuf::from(&current_path)
                        .join("steamapps")
                        .join("common")
                        .join(folder_name);
                    if candidate.join(GAME_EXE).exists() {
                        return Some(candidate.to_string_lossy().into_owned());
                    }
                }
            }
        }
    }

    None
}

// ─── Epic Games detection ────────────────────────────────────────

#[cfg(windows)]
fn detect_via_epic() -> Option<String> {
    let manifests_dir = PathBuf::from(
        std::env::var("PROGRAMDATA").unwrap_or_else(|_| r"C:\ProgramData".to_string()),
    )
    .join("Epic")
    .join("EpicGamesLauncher")
    .join("Data")
    .join("Manifests");

    if !manifests_dir.exists() {
        return None;
    }

    let entries = std::fs::read_dir(&manifests_dir).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("item") {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&path) {
            // Quick check before full JSON parse
            if !content.contains("F1Manager") {
                continue;
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                let app_name = json.get("AppName").and_then(|v| v.as_str()).unwrap_or("");
                if app_name.to_lowercase().contains("f1manager") {
                    if let Some(location) = json.get("InstallLocation").and_then(|v| v.as_str()) {
                        let exe = PathBuf::from(location).join(GAME_EXE);
                        if exe.exists() {
                            return Some(location.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

// ─── Helpers ─────────────────────────────────────────────────────

/// Normalize a Windows path to native separators.
///
/// Steam stores its install path in the registry with forward slashes
/// (`c:/program files (x86)/steam`). Rust's file APIs accept that happily, but
/// `explorer.exe` cannot parse it and silently opens the user's Documents
/// folder instead — so every path is normalized on the way in and on the way
/// out.
pub fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    #[cfg(windows)]
    let normalized = trimmed.replace('/', "\\");
    #[cfg(not(windows))]
    let normalized = trimmed.to_string();

    // Keep the separator on a drive root ("C:\"), drop it everywhere else.
    let trimmed_end = normalized.trim_end_matches(['\\', '/']);
    if trimmed_end.ends_with(':') {
        format!("{trimmed_end}\\")
    } else {
        trimmed_end.to_string()
    }
}

/// Returns the ~mods directory path given a game install path.
pub fn get_mods_dir(game_path: &str) -> PathBuf {
    PathBuf::from(normalize_path(game_path))
        .join("F1Manager24")
        .join("Content")
        .join("Paks")
        .join("~mods")
}

/// Open a folder in Windows Explorer, creating it if needed.
pub fn open_in_explorer(dir: &PathBuf) -> Result<(), String> {
    if !dir.exists() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    }

    #[cfg(target_os = "windows")]
    {
        // Explorer needs a native, slash-normalized path.
        let path = normalize_path(&dir.to_string_lossy());
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Cannot open Explorer: {e}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// True when the folder really is an F1 Manager 24 installation.
pub fn is_valid_game_path(game_path: &str) -> bool {
    let path = normalize_path(game_path);
    !path.is_empty() && PathBuf::from(path).join(GAME_EXE).exists()
}

// ─── Is the game holding our files open? ─────────────────────────
//
// Everything this app does to `~mods` is a rename, a move or a delete of a
// `.pak` the game memory-maps while it runs. Windows refuses those on an open
// file, so a toggle attempted mid-session fails *partway*: some files in a
// group are renamed and some are not, which is the one state the naming scheme
// cannot describe. The library then disagrees with the disk and the mod is
// half-applied in game.
//
// So it is refused up front, with an explanation, instead of being attempted
// and half-failing.

/// How long a process-list answer is reused.
///
/// Enumerating every process costs tens of milliseconds, and
/// `set_all_mods_enabled` calls `toggle_mod` once per mod — sixty mods would
/// otherwise mean sixty full scans and a visibly frozen window. Short enough
/// that closing the game feels immediate, long enough that a batch operation
/// pays for one scan rather than one per item.
const RUNNING_CACHE_MS: u128 = 1_500;

static RUNNING_CACHE: std::sync::Mutex<Option<(std::time::Instant, bool)>> =
    std::sync::Mutex::new(None);

/// True while F1 Manager 24 is running.
///
/// Matched on the exact executable name — a `contains` would also catch an
/// unrelated process that merely mentions it, and locking the user out of
/// their own mod folder over a false positive is worse than the race this
/// prevents.
///
/// Best-effort by nature: the game could start in the moment between this
/// answer and the rename that follows it. The point is to catch the ordinary
/// case — the user simply forgot the game was open — not to make the race
/// impossible.
pub fn is_game_running() -> bool {
    if let Ok(cache) = RUNNING_CACHE.lock() {
        if let Some((at, value)) = *cache {
            if at.elapsed().as_millis() < RUNNING_CACHE_MS {
                return value;
            }
        }
    }

    let running = scan_for_game();

    if let Ok(mut cache) = RUNNING_CACHE.lock() {
        *cache = Some((std::time::Instant::now(), running));
    }
    running
}

fn scan_for_game() -> bool {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let system = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::new()),
    );

    system
        .processes()
        .values()
        .any(|p| p.name().eq_ignore_ascii_case(GAME_EXE))
}

/// Guard for every command that writes into `~mods`.
///
/// One helper rather than a check per command, so a new mod-touching command
/// cannot forget it — and so the wording the user sees is identical wherever
/// they hit it.
pub fn ensure_game_closed() -> Result<(), String> {
    if is_game_running() {
        return Err(
            "F1 Manager 24 is running. Close the game first — its mod files are locked while it is open."
                .to_string(),
        );
    }
    Ok(())
}

/// Lets the UI grey out the controls instead of letting them fail.
#[tauri::command]
pub fn game_is_running() -> bool {
    is_game_running()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn normalizes_steam_registry_paths() {
        assert_eq!(
            normalize_path("c:/program files (x86)/steam\\steamapps\\common\\F1 Manager 2024"),
            "c:\\program files (x86)\\steam\\steamapps\\common\\F1 Manager 2024"
        );
        assert_eq!(normalize_path("D:/Games/F1/"), "D:\\Games\\F1");
        assert_eq!(normalize_path("C:/"), "C:\\");
        assert_eq!(normalize_path("  "), "");
    }
}

/// Tells the UI whether the saved path still points at a real installation
/// (the game may have been moved or uninstalled since it was configured).
#[tauri::command]
pub fn validate_game_path(state: tauri::State<crate::AppState>) -> Result<bool, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(is_valid_game_path(&conn.get_setting("game_path").unwrap_or_default()))
}
