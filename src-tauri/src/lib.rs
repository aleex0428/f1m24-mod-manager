// ─── lib.rs — Tauri v2 application entry point ──────────────────
//
// Declares all modules, registers commands, and sets up shared state.

mod auth;
mod db;
mod downloader;
mod game_detector;
mod launcher;
mod mod_manager;
mod mod_updater;
mod notify;
mod scraper_backend;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Manager;

use crate::downloader::{emit_ui, ActiveDownloadMap, PendingDownload};

// ─── Shared application state ────────────────────────────────────

pub struct AppState {
    pub db: Mutex<crate::db::DbStore>,
    /// Job the ghost webview has been told to fetch but has not started yet.
    pub pending_download: Mutex<Option<PendingDownload>>,
    /// Jobs currently transferring, keyed by destination file path.
    pub active_downloads: Mutex<ActiveDownloadMap>,
    /// True while the ghost webview is sitting on a login / challenge page.
    pub awaiting_login: AtomicBool,
    /// True once a login succeeded in this process. Covers sessions made
    /// without "stay signed in", which leave no persistent cookie.
    pub session_active: AtomicBool,
    /// Guards against starting more than one cookie watcher.
    pub login_watcher_running: AtomicBool,
}

// ─── Settings commands ───────────────────────────────────────────

#[tauri::command]
fn get_setting(key: String, state: tauri::State<AppState>) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(conn.get_setting(&key).unwrap_or_default())
}

#[tauri::command]
fn save_setting(key: String, value: String, state: tauri::State<AppState>) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.set_setting(key, value)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Fully exit the app (the window close button only hides to the tray).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        downloader::abort_all(&state);
    }
    app.exit(0);
}

// ─── Application bootstrap ───────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            // Only the main window is worth remembering. Restoring the hidden
            // helper webviews would pop them onto the user's screen.
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["overtake_ghost", "scraper"])
                .build(),
        )
        .setup(|app| {
            // Leftover archives from a previous run are dead weight on disk.
            let temp_dir = downloader::downloads_temp_root();
            if temp_dir.exists() {
                let _ = std::fs::remove_dir_all(&temp_dir);
            }
            let _ = std::fs::create_dir_all(&temp_dir);

            // ─── Initialize Database ─────────────────────────────────────
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./data"));

            let db_path = app_data_dir.join("mods.json");
            let store = db::DbStore::new(db_path);

            app.manage(AppState {
                db: Mutex::new(store),
                pending_download: Mutex::new(None),
                active_downloads: Mutex::new(ActiveDownloadMap::new()),
                awaiting_login: AtomicBool::new(false),
                session_active: AtomicBool::new(false),
                login_watcher_running: AtomicBool::new(false),
            });

            // Older builds stored the raw Steam registry path, which mixes
            // forward and back slashes and breaks explorer.exe.
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut conn) = state.db.lock() {
                    if let Some(saved) = conn.get_setting("game_path") {
                        let normalized = game_detector::normalize_path(&saved);
                        if normalized != saved {
                            let _ = conn.set_setting("game_path".to_string(), normalized.clone());
                        }

                        // Early builds created an unused "disabled" folder
                        // inside ~mods. Remove it if it is still empty.
                        let legacy = game_detector::get_mods_dir(&normalized).join("disabled");
                        if legacy.is_dir()
                            && legacy.read_dir().map(|mut d| d.next().is_none()).unwrap_or(false)
                        {
                            let _ = std::fs::remove_dir(&legacy);
                        }
                    }
                }
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if let Some(url) = event.urls().first() {
                        emit_ui(&app_handle, "deep-link-received", url.to_string());
                    }
                });
            }

            // ─── Ghost webview (download engine + login surface) ─────────
            let ghost_window = tauri::WebviewWindowBuilder::new(
                app,
                "overtake_ghost",
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .title("Link your Overtake account")
            .inner_size(900.0, 760.0)
            .resizable(false)
            .on_download(|webview, event| match event {
                tauri::webview::DownloadEvent::Requested { url, destination } => {
                    let app = webview.app_handle().clone();

                    // A challenge/login page is never a mod archive.
                    let url_str = url.as_str();
                    if url_str.contains("challenge-platform")
                        || url_str.contains("/login")
                        || url_str.contains("/register")
                    {
                        downloader::abort_for_auth(&app);
                        let _ = webview.window().show();
                        let _ = webview.window().set_focus();
                        return false;
                    }

                    downloader::handle_download_requested(&app, destination)
                }
                tauri::webview::DownloadEvent::Finished { url: _, path, success } => {
                    let app = webview.app_handle().clone();
                    downloader::handle_download_finished(&app, path, success);
                    true
                }
                _ => true,
            })
            // Detect login walls, Cloudflare challenges and successful logins.
            .on_page_load(move |webview, payload| {
                let url_str = payload.url().to_string();
                let app_handle = webview.app_handle().clone();
                let Some(state) = app_handle.try_state::<AppState>() else {
                    return;
                };

                let is_auth_wall = url_str.contains("overtake.gg/login")
                    || url_str.contains("overtake.gg/register")
                    || url_str.contains("/two-step");
                let is_challenge =
                    url_str.contains("challenge-platform") || url_str.contains("cdn-cgi/challenge");

                if is_auth_wall || is_challenge {
                    state.awaiting_login.store(true, Ordering::Relaxed);

                    // Seeing a login wall proves we are *not* authenticated,
                    // whatever the stored flag said.
                    auth::mark_logged_in(&app_handle, false);

                    // Only interrupt the user with a modal when this actually
                    // stopped a download — not when they opened the login page
                    // themselves from Settings.
                    if downloader::abort_for_auth(&app_handle) {
                        emit_ui(&app_handle, "auth-required", ());
                    }

                    let _ = webview.show();
                    let _ = webview.set_focus();
                    // The watcher is what notices the sign-in: XenForo logs in
                    // over XHR, and OAuth ends on pages that look identical to
                    // a guest's, so no URL can be trusted as a success signal.
                    auth::start_login_watcher(&app_handle);
                }
            })
            .build()?;

            #[cfg(debug_assertions)]
            ghost_window.open_devtools();

            use tauri::WindowEvent;
            let ghost_window_clone = ghost_window.clone();
            ghost_window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Destroying it would break every future download.
                    api.prevent_close();
                    let _ = ghost_window_clone.hide();
                    // Dismissing the login window cancels the sign-in attempt,
                    // so a later page load is not mistaken for a success.
                    if let Some(state) = ghost_window_clone.app_handle().try_state::<AppState>() {
                        state.awaiting_login.store(false, Ordering::Relaxed);
                    }
                }
            });

            // Trust the cookie jar, not the stored flag: a session made without
            // "stay signed in" is already gone by the time the app restarts.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                auth::refresh_session_state(&handle);
            });

            // ─── Tray icon ───────────────────────────────────────────────
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};

            let show_item = MenuItem::with_id(app, "show", "Open Mod Manager", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _ = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("F1 Manager 24 Mod Manager")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        if let Some(state) = app.try_state::<AppState>() {
                            downloader::abort_all(&state);
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Closing the main window hides to tray unless the user opted out
            // in Settings (Quit also lives in the tray menu).
            if let Some(main_window) = app.get_webview_window("main") {
                let main_clone = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let app = main_clone.app_handle();
                        let close_to_tray = app
                            .try_state::<AppState>()
                            .and_then(|state| {
                                state.db.lock().ok().map(|conn| {
                                    conn.get_setting("close_to_tray").as_deref() != Some("false")
                                })
                            })
                            .unwrap_or(true);

                        if close_to_tray {
                            api.prevent_close();
                            let _ = main_clone.hide();

                            // Tell the user where the app went — once.
                            let first_time = app
                                .try_state::<AppState>()
                                .and_then(|state| {
                                    state.db.lock().ok().map(|mut conn| {
                                        let shown =
                                            conn.get_setting("tray_hint_shown").as_deref() == Some("true");
                                        if !shown {
                                            let _ = conn.set_setting(
                                                "tray_hint_shown".to_string(),
                                                "true".to_string(),
                                            );
                                        }
                                        !shown
                                    })
                                })
                                .unwrap_or(false);

                            if first_time {
                                notify::notify(
                                    &app,
                                    "Still running",
                                    "F1M24 Mod Manager stays in the system tray. Right-click its icon to quit.",
                                );
                            }
                        } else if let Some(state) = app.try_state::<AppState>() {
                            downloader::abort_all(&state);
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Settings
            get_setting,
            save_setting,
            get_app_version,
            quit_app,
            // Auth
            auth::get_auth_status,
            auth::verify_session,
            auth::open_overtake_login,
            auth::cancel_overtake_login,
            auth::clear_session_cookie,
            // Game detection
            game_detector::detect_game_path,
            game_detector::select_game_path_dialog,
            game_detector::validate_game_path,
            // Mod management
            mod_manager::get_mods,
            mod_manager::install_mod,
            mod_manager::toggle_mod,
            mod_manager::delete_mod,
            mod_manager::detect_conflicts,
            mod_manager::apply_load_order,
            mod_manager::open_mods_folder,
            mod_manager::get_mods_dir_path,
            // Download
            downloader::start_download_job,
            downloader::cancel_download_job,
            downloader::open_archives_folder,
            downloader::get_archives_path,
            // Updater
            mod_updater::check_for_updates,
            mod_updater::update_mod,
            // Launcher
            launcher::launch_game,
            // Scraper
            scraper_backend::sync_overtake_database,
            scraper_backend::search_mods,
            scraper_backend::get_catalog_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
