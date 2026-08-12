// ─── downloader.rs — Background file download via Ghost Webview ─────
//
// Downloads are delegated to the hidden "overtake_ghost" webview so the
// request carries the user's real Cloudflare/session cookies.
//
// Lifecycle of a job:
//   start_download_job()            -> pending_download = Some(job)
//   DownloadEvent::Requested        -> job moves to active_downloads (keyed by
//                                      the destination path) + byte monitor starts
//   DownloadEvent::Finished         -> monitor stops, install runs, temp dir cleaned
//
// Every terminal path (success, failure, timeout, cancel) MUST clear the job
// from both maps and stop its monitor, otherwise the queue stalls forever.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{mod_manager, AppState};

/// How long we wait for the webview to actually start the transfer.
const START_TIMEOUT_SECS: u64 = 30;
/// Byte-monitor sampling interval.
const MONITOR_INTERVAL_MS: u64 = 600;
/// How long a parked install waits for the user to pick a variant.
const VARIANT_CHOICE_TIMEOUT_SECS: u64 = 10 * 60;
/// Hard safety cap so a monitor can never poll forever.
const MONITOR_MAX_TICKS: u64 = 60 * 60 * 1000 / MONITOR_INTERVAL_MS; // ~1h

// ─── In-flight bookkeeping ───────────────────────────────────────

/// A job we asked the webview to start but that has not begun transferring yet.
#[derive(Clone)]
pub struct PendingDownload {
    pub id: String,
    pub filename: String,
    pub page_url: String,
    pub download_url: String,
}

/// A job the webview is actively transferring.
pub struct ActiveDownload {
    pub id: String,
    pub page_url: String,
    pub temp_dir: PathBuf,
    pub stop: Arc<AtomicBool>,
}

// ─── Event payloads ──────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct DownloadStartedPayload {
    pub id: String,
    pub filename: String,
    pub url: String,
}

#[derive(Clone, Serialize)]
pub struct DownloadFinishedPayload {
    pub id: String,
    pub filename: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: u8,
    /// Bytes per second over the last sample window.
    pub speed: u64,
}

/// Sent when an archive turned out to hold several interchangeable versions
/// and the install is waiting for the user to pick one.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantRequiredPayload {
    pub job_id: Option<String>,
    pub staging_id: String,
    pub title: String,
    pub variants: Vec<crate::mod_manager::InstallVariant>,
}

#[derive(Clone, Serialize)]
pub struct DownloadStatusPayload {
    pub id: String,
    pub status: String,
}

#[derive(Clone, Serialize)]
pub struct DownloadErrorPayload {
    pub id: String,
    pub error: String,
    pub url: Option<String>,
}

/// Error string the frontend matches on to park a job as `login_required`.
pub const ERR_AUTH_REQUIRED: &str = "AUTH_REQUIRED";

// ─── Helpers ─────────────────────────────────────────────────────

/// Emit only to the main UI webview. A plain `emit` would also wake the ghost
/// and scraper webviews, which costs IPC round-trips for nothing.
pub fn emit_ui<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let _ = app.emit_to("main", event, payload);
}

/// Root of every temp download folder. Archives live here only while they are
/// being installed; the permanent copy (if enabled) goes to [`archives_dir`].
pub fn downloads_temp_root() -> PathBuf {
    std::env::temp_dir().join("f1m24-mod-manager")
}

/// Where downloaded archives are kept so they can be reinstalled offline.
pub fn archives_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("./data"))
        .join("archives")
}

/// Whether to keep a copy of each downloaded archive (Settings toggle).
fn keep_archives(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|state| {
            state
                .db
                .lock()
                .ok()
                .map(|conn| conn.get_setting("keep_archives").as_deref() != Some("false"))
        })
        .unwrap_or(true)
}

/// Copy a freshly installed archive into the permanent archives folder.
pub fn store_archive(app: &AppHandle, source: &PathBuf) {
    if !keep_archives(app) {
        return;
    }

    let dir = archives_dir(app);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    if let Some(name) = source.file_name() {
        // Overwriting is intended: the same mod re-downloaded is a newer file.
        let _ = std::fs::copy(source, dir.join(name));
    }
}

/// Open the archives folder in the file manager.
#[tauri::command]
pub fn open_archives_folder(app: AppHandle) -> Result<(), String> {
    crate::game_detector::open_in_explorer(&archives_dir(&app))
}

/// Absolute path of the archives folder, for display in the UI.
#[tauri::command]
pub fn get_archives_path(app: AppHandle) -> String {
    archives_dir(&app).to_string_lossy().to_string()
}

/// Only overtake.gg (and its CDN) may be driven through the ghost webview.
fn is_allowed_download_url(url: &str) -> bool {
    match tauri::Url::parse(url) {
        Ok(u) => {
            if u.scheme() != "https" {
                return false;
            }
            match u.host_str() {
                Some(host) => {
                    let host = host.to_ascii_lowercase();
                    host == "overtake.gg" || host.ends_with(".overtake.gg")
                }
                None => false,
            }
        }
        Err(_) => false,
    }
}

/// Best-effort filename from a URL, used until the server tells us the real one.
fn filename_from_url(url: &str) -> String {
    let name = url
        .split('?')
        .next()
        .unwrap_or(url)
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("mod.archive")
        .trim();

    if name.is_empty() || name == "download" {
        "mod.archive".to_string()
    } else {
        name.to_string()
    }
}

/// Drop the pending job (if it matches `id`, or unconditionally when `id` is None).
fn take_pending(state: &AppState, id: Option<&str>) -> Option<PendingDownload> {
    let mut pending = state.pending_download.lock().ok()?;
    let matches = match (&*pending, id) {
        (Some(p), Some(id)) => p.id == id,
        (Some(_), None) => true,
        _ => false,
    };
    if matches {
        pending.take()
    } else {
        None
    }
}

/// Stop the byte monitor and forget an active download.
fn take_active(state: &AppState, path: Option<&PathBuf>) -> Option<ActiveDownload> {
    let mut active = state.active_downloads.lock().ok()?;

    let key = match path {
        Some(p) if active.contains_key(p) => Some(p.clone()),
        // The webview occasionally reports a slightly different path (e.g. a
        // `.crdownload` rename). With a serial queue there is at most one job
        // in flight, so falling back to the single entry is safe.
        _ if active.len() == 1 => active.keys().next().cloned(),
        _ => None,
    }?;

    let job = active.remove(&key);
    if let Some(ref j) = job {
        j.stop.store(true, Ordering::Relaxed);
    }
    job
}

/// Abort every in-flight job. Used on shutdown / logout.
pub fn abort_all(state: &AppState) {
    if let Ok(mut pending) = state.pending_download.lock() {
        *pending = None;
    }
    if let Ok(mut active) = state.active_downloads.lock() {
        for (_, job) in active.drain() {
            job.stop.store(true, Ordering::Relaxed);
            let _ = std::fs::remove_dir_all(&job.temp_dir);
        }
    }
}

// ─── Commands ────────────────────────────────────────────────────

/// Ask the ghost webview to fetch `download_url`.
#[tauri::command]
pub async fn start_download_job(
    job_id: String,
    download_url: String,
    page_url: String,
    app: AppHandle,
) -> Result<String, String> {
    if !is_allowed_download_url(&download_url) {
        return Err("Unsupported download URL (only https://overtake.gg links are allowed).".into());
    }

    let target = tauri::Url::parse(&download_url).map_err(|e| format!("Invalid URL: {e}"))?;

    let ghost_window = app
        .get_webview_window("overtake_ghost")
        .ok_or("Download engine window is not available. Restart the app.")?;

    // Fail fast without a session: navigating would only bounce off the login
    // wall and burn the whole watchdog window before reporting anything.
    if !crate::auth::session_likely_valid(&app).await {
        emit_ui(
            &app,
            "download-error",
            DownloadErrorPayload {
                id: job_id.clone(),
                error: ERR_AUTH_REQUIRED.to_string(),
                url: Some(page_url.clone()),
            },
        );
        emit_ui(&app, "auth-required", ());
        return Ok(job_id);
    }

    let filename = filename_from_url(&download_url);

    {
        let state = app.state::<AppState>();
        // A previous job that never started must not hijack this one.
        let stale = take_pending(&state, None);
        if let Some(stale) = stale {
            if stale.id != job_id {
                emit_ui(
                    &app,
                    "download-error",
                    DownloadErrorPayload {
                        id: stale.id,
                        error: "Superseded by a newer download.".to_string(),
                        url: Some(stale.page_url),
                    },
                );
            }
        }

        let mut pending = state
            .pending_download
            .lock()
            .map_err(|_| "Download state is locked".to_string())?;
        *pending = Some(PendingDownload {
            id: job_id.clone(),
            filename: filename.clone(),
            page_url: page_url.clone(),
            download_url: download_url.clone(),
        });
    }

    // Navigating the webview is what triggers the native download. This must
    // be `navigate`, not eval'ing `window.location`: the ghost webview sits on
    // about:blank until something loads a page there, and script injected into
    // about:blank is silently dropped — the download would never start and the
    // job would hang on "connecting" until the watchdog fired.
    if let Err(e) = ghost_window.navigate(target) {
        let state = app.state::<AppState>();
        take_pending(&state, Some(&job_id));
        emit_ui(
            &app,
            "download-error",
            DownloadErrorPayload {
                id: job_id.clone(),
                error: format!("Could not reach the download engine: {e}"),
                url: Some(page_url.clone()),
            },
        );
        return Ok(job_id);
    }

    emit_ui(
        &app,
        "download-status",
        DownloadStatusPayload {
            id: job_id.clone(),
            status: "connecting".to_string(),
        },
    );

    // Watchdog: if the transfer never starts, release the queue.
    let watchdog_app = app.clone();
    let watchdog_id = job_id.clone();
    let watchdog_page = page_url.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(START_TIMEOUT_SECS)).await;
        let state = watchdog_app.state::<AppState>();
        if take_pending(&state, Some(&watchdog_id)).is_some() {
            emit_ui(
                &watchdog_app,
                "download-error",
                DownloadErrorPayload {
                    id: watchdog_id,
                    error: "Overtake never started the file. Re-link your account or solve the captcha and try again.".to_string(),
                    url: Some(watchdog_page),
                },
            );
        }
    });

    Ok(job_id)
}

/// Cancel a job that is queued, waiting or transferring.
#[tauri::command]
pub fn cancel_download_job(job_id: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    let was_pending = take_pending(&state, Some(&job_id)).is_some();

    let active_job = {
        let mut active = state
            .active_downloads
            .lock()
            .map_err(|_| "Download state is locked".to_string())?;
        let key = active
            .iter()
            .find(|(_, j)| j.id == job_id)
            .map(|(k, _)| k.clone());
        key.and_then(|k| active.remove(&k))
    };

    if let Some(job) = active_job {
        job.stop.store(true, Ordering::Relaxed);
        let _ = std::fs::remove_dir_all(&job.temp_dir);
    } else if !was_pending {
        return Ok(());
    }

    // Navigating away aborts the in-flight transfer.
    if let Some(window) = app.get_webview_window("overtake_ghost") {
        let _ = window.eval("window.stop && window.stop();");
    }

    emit_ui(
        &app,
        "download-status",
        DownloadStatusPayload {
            id: job_id,
            status: "canceled".to_string(),
        },
    );

    Ok(())
}

// ─── Webview download events ─────────────────────────────────────

/// Called from the ghost webview's `on_download` hook when a transfer starts.
/// Returns `false` to reject the download.
pub fn handle_download_requested(app: &AppHandle, destination: &mut PathBuf) -> bool {
    let state = app.state::<AppState>();

    let Some(job) = take_pending(&state, None) else {
        // Nothing queued: an unexpected download (ad, stray click). Reject it.
        return false;
    };

    // Route the file into our own temp folder, one directory per job.
    let temp_dir = downloads_temp_root().join(&job.id);
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        emit_ui(
            app,
            "download-error",
            DownloadErrorPayload {
                id: job.id,
                error: format!("Cannot create temp folder: {e}"),
                url: Some(job.page_url),
            },
        );
        return false;
    }

    // Prefer the filename the server sent (Content-Disposition), fall back to the URL.
    let final_filename = destination
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_else(|| std::ffi::OsString::from(&job.filename));
    *destination = temp_dir.join(&final_filename);

    let display_name = final_filename.to_string_lossy().to_string();

    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut active = match state.active_downloads.lock() {
            Ok(a) => a,
            Err(_) => return false,
        };
        active.insert(
            destination.clone(),
            ActiveDownload {
                id: job.id.clone(),
                page_url: job.page_url.clone(),
                temp_dir: temp_dir.clone(),
                stop: stop.clone(),
            },
        );
    }

    emit_ui(
        app,
        "download-started",
        DownloadStartedPayload {
            id: job.id.clone(),
            filename: display_name,
            url: job.page_url.clone(),
        },
    );

    spawn_byte_monitor(app.clone(), job.id, destination.clone(), temp_dir, stop);
    true
}

/// Called from the ghost webview's `on_download` hook when a transfer ends.
pub fn handle_download_finished(app: &AppHandle, path: Option<PathBuf>, success: bool) {
    let state = app.state::<AppState>();

    let Some(job) = take_active(&state, path.as_ref()) else {
        return;
    };

    let downloaded_path = match (success, path) {
        (true, Some(p)) if p.exists() => p,
        (true, _) => {
            // Some webview builds report success with no usable path.
            match largest_file_in(&job.temp_dir) {
                Some(p) => p,
                None => {
                    let _ = std::fs::remove_dir_all(&job.temp_dir);
                    emit_ui(
                        app,
                        "download-error",
                        DownloadErrorPayload {
                            id: job.id,
                            error: "The download was aborted by the system.".to_string(),
                            url: Some(job.page_url),
                        },
                    );
                    return;
                }
            }
        }
        (false, _) => {
            let _ = std::fs::remove_dir_all(&job.temp_dir);
            emit_ui(
                app,
                "download-error",
                DownloadErrorPayload {
                    id: job.id,
                    error: "The download failed or was blocked (Cloudflare / network error)."
                        .to_string(),
                    url: Some(job.page_url),
                },
            );
            return;
        }
    };

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = finish_ghost_download(job.id, job.page_url, downloaded_path, app_for_task).await;
    });
}

/// Abort whatever is in flight because the site demanded auth / a captcha.
/// Returns true when a download was actually interrupted, so the caller can
/// tell "your download needs a login" apart from "the user opened the login
/// page on purpose".
pub fn abort_for_auth(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();

    let pending = take_pending(&state, None);
    let active = take_active(&state, None);
    let interrupted = pending.is_some() || active.is_some();

    if let Some(job) = pending {
        emit_ui(
            app,
            "download-error",
            DownloadErrorPayload {
                id: job.id,
                error: ERR_AUTH_REQUIRED.to_string(),
                url: Some(job.page_url),
            },
        );
    }

    if let Some(job) = active {
        let _ = std::fs::remove_dir_all(&job.temp_dir);
        emit_ui(
            app,
            "download-error",
            DownloadErrorPayload {
                id: job.id,
                error: ERR_AUTH_REQUIRED.to_string(),
                url: Some(job.page_url),
            },
        );
    }

    interrupted
}

/// Biggest file in the job folder — the archive, never a stray partial.
fn largest_file_in(dir: &PathBuf) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let len = e.metadata().ok().filter(|m| m.is_file())?.len();
            Some((len, path))
        })
        .max_by_key(|(len, _)| *len)
        .map(|(_, path)| path)
}

/// Largest file currently inside the job's temp folder.
///
/// The webview may stream into a partial file (`name.crdownload`) before
/// renaming it to the final destination, so the folder is the reliable source.
fn bytes_written(path: &PathBuf, temp_dir: &PathBuf) -> u64 {
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > 0 {
            return meta.len();
        }
    }

    std::fs::read_dir(temp_dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| e.metadata().ok())
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .max()
                .unwrap_or(0)
        })
        .unwrap_or(0)
}

/// Poll the growing temp file and report transferred bytes + speed.
fn spawn_byte_monitor(
    app: AppHandle,
    job_id: String,
    path: PathBuf,
    temp_dir: PathBuf,
    stop: Arc<AtomicBool>,
) {
    tauri::async_runtime::spawn(async move {
        let mut last_bytes = 0u64;
        let mut last_at = Instant::now();
        let mut ticks = 0u64;

        while !stop.load(Ordering::Relaxed) && ticks < MONITOR_MAX_TICKS {
            tokio::time::sleep(std::time::Duration::from_millis(MONITOR_INTERVAL_MS)).await;
            ticks += 1;

            let bytes = bytes_written(&path, &temp_dir);
            // Nothing changed — skip the IPC round-trip entirely.
            if bytes == last_bytes {
                continue;
            }

            let elapsed = last_at.elapsed().as_secs_f64().max(0.001);
            let speed = ((bytes.saturating_sub(last_bytes)) as f64 / elapsed) as u64;
            last_bytes = bytes;
            last_at = Instant::now();

            emit_ui(
                &app,
                "download-progress",
                DownloadProgressPayload {
                    id: job_id.clone(),
                    downloaded: bytes,
                    total: 0, // the webview does not expose Content-Length
                    percentage: 0,
                    speed,
                },
            );
        }
    });
}

// ─── Install step ────────────────────────────────────────────────

/// Runs once the bytes are on disk: verify, install, clean up, notify.
pub async fn finish_ghost_download(
    download_id: String,
    page_url: String,
    downloaded_path: PathBuf,
    app: AppHandle,
) -> Result<(), String> {
    let temp_dir = downloaded_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| downloads_temp_root().join(&download_id));

    let filename = downloaded_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    emit_ui(
        &app,
        "download-status",
        DownloadStatusPayload {
            id: download_id.clone(),
            status: "verifying".to_string(),
        },
    );

    // A Cloudflare challenge page or an empty file is not a mod archive.
    let size = std::fs::metadata(&downloaded_path).map(|m| m.len()).unwrap_or(0);
    if size < 1024 {
        let _ = std::fs::remove_dir_all(&temp_dir);
        let msg = "The server returned an empty file (session expired or captcha).".to_string();
        emit_ui(
            &app,
            "download-error",
            DownloadErrorPayload {
                id: download_id,
                error: msg.clone(),
                url: Some(page_url),
            },
        );
        return Err(msg);
    }

    emit_ui(
        &app,
        "download-status",
        DownloadStatusPayload {
            id: download_id.clone(),
            status: "installing".to_string(),
        },
    );

    let zip_path = downloaded_path.to_string_lossy().to_string();
    let state = app.state::<AppState>();
    let result = mod_manager::install_mod(zip_path, Some(page_url.clone()), state, app.clone()).await;

    // The archive holds alternatives: hand the question to the UI and keep both
    // the extraction and the download around until an answer arrives.
    if let Ok(mod_manager::InstallOutcome::NeedsVariant { staging_id, variants }) = &result {
        attach_pending_download(
            &app,
            staging_id,
            download_id.clone(),
            downloaded_path.clone(),
            temp_dir.clone(),
        );

        emit_ui(
            &app,
            "download-status",
            DownloadStatusPayload {
                id: download_id.clone(),
                status: "awaiting_input".to_string(),
            },
        );
        emit_ui(
            &app,
            "install-variant-required",
            VariantRequiredPayload {
                job_id: Some(download_id.clone()),
                staging_id: staging_id.clone(),
                title: filename.clone(),
                variants: variants.clone(),
            },
        );

        spawn_variant_timeout(app.clone(), staging_id.clone());
        return Ok(());
    }

    // Keep a copy of what worked, then drop the temp folder either way.
    if result.is_ok() {
        store_archive(&app, &downloaded_path);
    }
    let _ = std::fs::remove_dir_all(&temp_dir);

    match result {
        Ok(_) => {
            crate::notify::notify(&app, "Mod installed", &format!("{filename} is ready to race."));
            emit_ui(
                &app,
                "download-finished",
                DownloadFinishedPayload {
                    id: download_id,
                    filename,
                },
            );
            emit_ui(&app, "mod-installed", ());
            Ok(())
        }
        Err(e) => {
            crate::notify::notify(&app, "Install failed", &e);
            emit_ui(
                &app,
                "download-error",
                DownloadErrorPayload {
                    id: download_id,
                    error: e.clone(),
                    url: Some(page_url),
                },
            );
            Err(e)
        }
    }
}

// Keeps the type importable from lib.rs without pulling std::collections there.
pub type ActiveDownloadMap = HashMap<PathBuf, ActiveDownload>;

// ─── Parked installs ─────────────────────────────────────────────

/// Give a parked extraction the download context it needs to be completed or
/// failed later, once the user has answered.
fn attach_pending_download(
    app: &AppHandle,
    staging_id: &str,
    job_id: String,
    archive_path: PathBuf,
    archive_dir: PathBuf,
) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut pending) = state.pending_installs.lock() {
            if let Some(entry) = pending.get_mut(staging_id) {
                entry.job_id = Some(job_id);
                entry.archive_path = Some(archive_path);
                entry.archive_dir = Some(archive_dir);
            }
        }
    }
}

/// Close the download job behind a parked install.
pub fn finish_pending_job(
    app: &AppHandle,
    pending: &crate::mod_manager::PendingInstall,
    error: Option<String>,
) {
    let Some(job_id) = pending.job_id.clone() else {
        return; // Installed from a local file: there is no queue entry.
    };

    match error {
        None => {
            let filename = pending
                .archive_path
                .as_ref()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| pending.mod_name.clone());

            crate::notify::notify(app, "Mod installed", &format!("{filename} is ready to race."));
            emit_ui(
                app,
                "download-finished",
                DownloadFinishedPayload { id: job_id, filename },
            );
        }
        Some(message) => {
            emit_ui(
                app,
                "download-error",
                DownloadErrorPayload {
                    id: job_id,
                    error: message,
                    url: pending.source_url.clone(),
                },
            );
        }
    }
}

/// A question nobody answers must not hold the download slot forever.
fn spawn_variant_timeout(app: AppHandle, staging_id: String) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(VARIANT_CHOICE_TIMEOUT_SECS)).await;

        let pending = app.try_state::<AppState>().and_then(|state| {
            state
                .pending_installs
                .lock()
                .ok()
                .and_then(|mut map| map.remove(&staging_id))
        });

        if let Some(pending) = pending {
            let _ = std::fs::remove_dir_all(&pending.staging_dir);
            if let Some(dir) = &pending.archive_dir {
                let _ = std::fs::remove_dir_all(dir);
            }
            finish_pending_job(
                &app,
                &pending,
                Some("Timed out waiting for you to choose a version.".to_string()),
            );
        }
    });
}
