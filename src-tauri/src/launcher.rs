// ─── launcher.rs — Launch F1 Manager 24 ─────────────────────────
//
// Detects whether Steam or EA App is available and launches accordingly.

use tauri::State;

use crate::AppState;

/// Launch F1 Manager 24 using the appropriate launcher.
#[tauri::command]
pub async fn launch_game(state: State<'_, AppState>) -> Result<(), String> {
    let game_path = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::game_detector::normalize_path(&conn.get_setting("game_path").unwrap_or_default())
    };

    let exe = std::path::PathBuf::from(&game_path).join("F1Manager24.exe");
    let has_exe = !game_path.is_empty() && exe.exists();
    // Only route through Steam when the copy really lives in a Steam library —
    // an Epic/standalone install would silently do nothing.
    let is_steam_copy = game_path.to_lowercase().contains("steamapps");

    // 1. Steam copy → let Steam handle it (DRM, overlay, cloud saves).
    if is_steam_copy && find_steam_exe().is_some() {
        open_uri("steam://run/2591280")?;
        return Ok(());
    }

    // 2. Anything else we can see on disk → launch it directly.
    if has_exe {
        std::process::Command::new(&exe)
            .current_dir(&game_path)
            .spawn()
            .map_err(|e| format!("Failed to launch the game: {e}"))?;
        return Ok(());
    }

    // 3. No known path: fall back to the launchers.
    if find_steam_exe().is_some() {
        open_uri("steam://run/2591280")?;
        return Ok(());
    }

    if let Some(ea_path) = find_ea_app_exe() {
        std::process::Command::new(&ea_path)
            .spawn()
            .map_err(|e| format!("Failed to open EA App: {e}"))?;
        return Ok(());
    }

    Err("Could not find F1 Manager 24. Set the game folder in Settings.".into())
}

// ─── Private helpers ─────────────────────────────────────────────

/// Hand a `steam://` style URI to the OS shell.
fn open_uri(uri: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", uri])
            .spawn()
            .map_err(|e| format!("Cannot open {uri}: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(uri)
            .spawn()
            .map_err(|e| format!("Cannot open {uri}: {e}"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn find_steam_exe() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let steam_key = hklm
        .open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam")
        .or_else(|_| hklm.open_subkey(r"SOFTWARE\Valve\Steam"))
        .ok()?;

    let install_path: String = steam_key.get_value("InstallPath").ok()?;
    let exe = std::path::PathBuf::from(install_path).join("steam.exe");

    if exe.exists() {
        Some(exe.to_string_lossy().into_owned())
    } else {
        None
    }
}

#[cfg(not(windows))]
fn find_steam_exe() -> Option<String> {
    // On non-Windows, check common paths
    let paths = ["/usr/bin/steam", "/usr/local/bin/steam"];
    for p in &paths {
        if std::path::Path::new(p).exists() {
            return Some(p.to_string());
        }
    }
    None
}

#[cfg(windows)]
fn find_ea_app_exe() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // EA App registry paths
    let ea_paths = [
        r"SOFTWARE\Electronic Arts\EA Desktop",
        r"SOFTWARE\WOW6432Node\Electronic Arts\EA Desktop",
    ];

    for path in &ea_paths {
        if let Ok(key) = hklm.open_subkey(path) {
            if let Ok(install_dir) = key.get_value::<String, _>("InstallDir") {
                let exe = std::path::PathBuf::from(install_dir).join("EADesktop.exe");
                if exe.exists() {
                    return Some(exe.to_string_lossy().into_owned());
                }
            }
        }
    }

    // Fallback known path
    let default = r"C:\Program Files\Electronic Arts\EA Desktop\EADesktop.exe";
    if std::path::Path::new(default).exists() {
        return Some(default.to_string());
    }

    None
}

#[cfg(not(windows))]
fn find_ea_app_exe() -> Option<String> {
    None
}
