// ─── notify.rs — Native Windows toast notifications ─────────────

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Send a native notification, unless the user turned them off in Settings.
pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let enabled = app
        .try_state::<crate::AppState>()
        .and_then(|state| {
            state
                .db
                .lock()
                .ok()
                .map(|conn| conn.get_setting("notifications_enabled").as_deref() != Some("false"))
        })
        .unwrap_or(true);

    if !enabled {
        return;
    }

    let _ = app.notification().builder().title(title).body(body).show();
}
