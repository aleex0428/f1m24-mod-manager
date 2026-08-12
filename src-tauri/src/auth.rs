// ─── auth.rs — Overtake.gg session handling ─────────────────────
//
// The real session lives in the ghost webview's cookie jar (WebView2 keeps it
// on disk between runs). The database only mirrors it so the UI can render the
// right state without touching the webview.
//
// Detecting "the user just signed in" by watching navigations alone is
// unreliable: XenForo submits its login form over XHR, so a successful login
// often produces no page load at all. Instead we poll the cookie store, which
// is authoritative and works no matter how the site performs the login.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::downloader::emit_ui;
use crate::AppState;

pub const GHOST_LABEL: &str = "overtake_ghost";
const ORIGIN: &str = "https://www.overtake.gg";
const LOGIN_URL: &str = "https://www.overtake.gg/login/";

/// XenForo's "stay signed in" cookie. Its presence means the session survives
/// an app restart; `xf_session` is set for guests too and proves nothing.
const PERSISTENT_COOKIE: &str = "xf_user";

/// Cookie our own probe script writes so Rust can read what the page reports.
const PROBE_COOKIE: &str = "f1m24_state";

/// Asks the *page* whether it is rendered for a signed-in member and mirrors
/// the answer into a first-party session cookie, which Rust can then read.
///
/// This is deliberately not a navigation check: the OAuth "Continue with
/// Google → Confirm" step is served from overtake.gg while the visitor is
/// still a guest, so any URL-based guess reports a login that never happened.
/// It is also non-destructive — unlike the scraper's redirect trick, it cannot
/// navigate away from a form the user is filling in.
const PROBE_JS: &str = r#"
(function () {
  try {
    if (!/(^|\.)overtake\.gg$/.test(location.hostname)) return;
    var root = document.documentElement;
    var member =
      root.getAttribute('data-logged-in') === 'true' ||
      !!document.querySelector('a[href*="/logout/"]') ||
      !!document.querySelector('.p-navgroup--member, .p-navgroup-link--user');
    // Session cookie (no max-age): it cannot survive into the next app run.
    document.cookie = 'f1m24_state=' + (member ? '1' : '0') + ';path=/;SameSite=Lax';
  } catch (e) {}
})();
"#;

const WATCH_INTERVAL: Duration = Duration::from_millis(1200);
const WATCH_TIMEOUT: Duration = Duration::from_secs(15 * 60);

// ─── Database mirror ─────────────────────────────────────────────

pub fn save_login_status(conn: &mut crate::db::DbStore, logged_in: bool) -> Result<(), String> {
    conn.set_setting(
        "is_logged_in".to_string(),
        if logged_in { "true" } else { "false" }.to_string(),
    )
}

pub fn load_login_status(conn: &crate::db::DbStore) -> bool {
    conn.get_setting("is_logged_in").as_deref() == Some("true")
}

/// Record the session state and tell the UI about it. Safe to call from event
/// handlers: it never touches the webview.
pub fn mark_logged_in(app: &AppHandle, logged_in: bool) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let previous = state.session_active.swap(logged_in, Ordering::Relaxed);
    if let Ok(mut conn) = state.db.lock() {
        let _ = save_login_status(&mut conn, logged_in);
    }
    if logged_in {
        state.awaiting_login.store(false, Ordering::Relaxed);
    }

    emit_ui(app, "auth-status", serde_json::json!({ "logged_in": logged_in }));

    if logged_in && !previous {
        // Keeps the legacy event working for anything still listening to it.
        emit_ui(app, "overtake_login_success", ());
    }
}

// ─── Cookie inspection ───────────────────────────────────────────

pub fn ghost_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(GHOST_LABEL)
}

/// Read the cookie jar for a persistent Overtake session.
///
/// `None` means the cookie store could not be read — never treat that as "not
/// signed in", or a flaky read would log the user out of a working session.
///
/// MUST NOT run on the main thread: on Windows this call dispatches to the UI
/// thread and blocks, so calling it from a sync command or an event handler
/// deadlocks the app (wry#583).
fn persistent_session(window: &WebviewWindow) -> Option<bool> {
    let url = ORIGIN.parse().ok()?;
    let cookies = window.cookies_for_url(url).ok()?;
    Some(
        cookies
            .iter()
            .any(|c| c.name() == PERSISTENT_COOKIE && !c.value().trim().is_empty()),
    )
}

/// Signed-in state right now: either a persistent cookie, or the loaded page
/// telling us it is rendered for a member (covers logins made without "stay
/// signed in", which leave no persistent cookie behind).
///
/// Same threading rules as [`persistent_session`].
fn live_session(window: &WebviewWindow) -> Option<bool> {
    let url: tauri::Url = ORIGIN.parse().ok()?;
    let cookies = window.cookies_for_url(url).ok()?;

    let signed_in = cookies.iter().any(|c| {
        (c.name() == PERSISTENT_COOKIE && !c.value().trim().is_empty())
            || (c.name() == PROBE_COOKIE && c.value() == "1")
    });

    Some(signed_in)
}

// ─── Login watcher ───────────────────────────────────────────────

/// Poll the cookie jar until the user is signed in, the window is dismissed or
/// the watch times out. Started whenever an auth wall becomes visible.
pub fn start_login_watcher(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    // Only ever one watcher at a time.
    if state
        .login_watcher_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        let started = Instant::now();

        loop {
            std::thread::sleep(WATCH_INTERVAL);

            let Some(state) = app.try_state::<AppState>() else {
                break;
            };
            let Some(window) = ghost_window(&app) else {
                break;
            };

            // The user closed/hid the login window: stop watching.
            if !window.is_visible().unwrap_or(false) {
                break;
            }
            if started.elapsed() > WATCH_TIMEOUT {
                break;
            }

            // Ask the current page what it thinks; the answer lands in the
            // probe cookie and is read on the next tick.
            let _ = window.eval(PROBE_JS);

            if live_session(&window) == Some(true) {
                let _ = window.hide();
                mark_logged_in(&app, true);
                emit_ui(&app, "auth-linked", ());
                break;
            }

            if !state.awaiting_login.load(Ordering::Relaxed) {
                break;
            }
        }

        if let Some(state) = app.try_state::<AppState>() {
            state.awaiting_login.store(false, Ordering::Relaxed);
            state.login_watcher_running.store(false, Ordering::Relaxed);
        }
    });
}

/// Cheap pre-flight used before starting a download.
///
/// Returns false only when we are *sure* there is no session — an unreadable
/// cookie store must never block a download that would have worked.
pub async fn session_likely_valid(app: &AppHandle) -> bool {
    let active_this_run = app
        .try_state::<AppState>()
        .map(|state| state.session_active.load(Ordering::Relaxed))
        .unwrap_or(false);

    if active_this_run {
        return true;
    }

    let Some(window) = ghost_window(app) else {
        return true;
    };

    tauri::async_runtime::spawn_blocking(move || live_session(&window).unwrap_or(true))
        .await
        .unwrap_or(true)
}

/// Startup check: trust the cookie jar, not the stored flag. A session that is
/// not persistent is already gone by the time the app restarts.
pub fn refresh_session_state(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let read = ghost_window(&app).and_then(|w| persistent_session(&w));

        let logged_in = match read {
            Some(value) => value,
            // Cookie store unreadable: keep whatever we had rather than
            // wrongly telling the user they were signed out.
            None => app
                .try_state::<AppState>()
                .and_then(|state| state.db.lock().ok().map(|conn| load_login_status(&conn)))
                .unwrap_or(false),
        };

        mark_logged_in(&app, logged_in);
    });
}

// ─── Tauri commands ─────────────────────────────────────────────

/// Cheap, synchronous read of the mirrored state (never touches cookies).
#[tauri::command]
pub fn get_auth_status(state: tauri::State<AppState>) -> bool {
    state.db.lock().map(|conn| load_login_status(&conn)).unwrap_or(false)
}

/// Re-check the session on demand.
///
/// A login made without "stay signed in" leaves no persistent cookie, so the
/// in-process flag counts as proof for the rest of this run.
#[tauri::command]
pub async fn verify_session(app: AppHandle) -> Result<bool, String> {
    let window = ghost_window(&app).ok_or("Login window is not available. Restart the app.")?;

    // Refresh the probe cookie from whatever page is loaded, then read it.
    let _ = window.eval(PROBE_JS);
    tokio::time::sleep(Duration::from_millis(400)).await;

    let cookie = tauri::async_runtime::spawn_blocking(move || live_session(&window))
        .await
        .map_err(|e| e.to_string())?;

    let active_this_run = app
        .try_state::<AppState>()
        .map(|state| state.session_active.load(Ordering::Relaxed))
        .unwrap_or(false);

    let logged_in = match cookie {
        Some(has_cookie) => has_cookie || active_this_run,
        None => {
            return Err(
                "Could not read the browser session. Try again, or sign in once more.".to_string(),
            )
        }
    };

    mark_logged_in(&app, logged_in);
    Ok(logged_in)
}

/// Open the ghost webview on the login page and watch for success.
#[tauri::command]
pub fn open_overtake_login(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    let window = ghost_window(&app).ok_or("Login window is not available. Restart the app.")?;

    let url = LOGIN_URL
        .parse()
        .map_err(|_| "Invalid login URL".to_string())?;

    // `navigate` drives the webview directly — far more reliable than eval'ing
    // `window.location`, which silently does nothing on about:blank in some
    // WebView2 builds.
    window.navigate(url).map_err(|e| e.to_string())?;

    state.awaiting_login.store(true, Ordering::Relaxed);

    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|e| e.to_string())?;

    start_login_watcher(&app);
    Ok(())
}


/// Log out: drop the cookies, stop any download and reset the mirrored state.
#[tauri::command]
pub async fn clear_session_cookie(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<AppState>() {
        crate::downloader::abort_all(&state);
        state.awaiting_login.store(false, Ordering::Relaxed);
    }

    if let Some(window) = ghost_window(&app) {
        let hide_target = window.clone();
        // Clearing browsing data blocks on the UI thread — keep it off it.
        tauri::async_runtime::spawn_blocking(move || {
            let _ = window.clear_all_browsing_data();
            if let Ok(url) = "about:blank".parse() {
                let _ = window.navigate(url);
            }
        })
        .await
        .map_err(|e| e.to_string())?;
        let _ = hide_target.hide();
    }

    mark_logged_in(&app, false);
    Ok(())
}
