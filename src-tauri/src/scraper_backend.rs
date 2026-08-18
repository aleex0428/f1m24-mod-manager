// ─── scraper_backend.rs — Overtake.gg catalog sync ──────────────
//
// A hidden webview walks the category listing and hands the parsed rows back
// through a fake navigation (`/f1m24-scrape-result?data=<hex>`), which works
// even behind Cloudflare because it is the real browser doing the request.

use std::time::Duration;

use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::db::ModCache;
use crate::AppState;

const BASE_URL: &str = "https://www.overtake.gg/downloads/categories/f1-manager-2024.272/?order=last_update&direction=desc";
/// Safety net so a broken layout can never spin forever.
const MAX_PAGES: usize = 60;
/// Per-page budget: 150ms × 200 ≈ 30s.
const POLL_INTERVAL_MS: u64 = 150;
const POLL_ATTEMPTS: usize = 200;

const SCRAPE_JS: &str = r#"
(function() {
    if (window.__f1m24_scraper_active) return;

    const items = document.querySelectorAll('.structItem.structItem--resource');
    if (items.length === 0) return;
    window.__f1m24_scraper_active = true;

    const mods = [];
    items.forEach(item => {
        if (item.classList.contains('samUnitWrapper')) return;
        const titleLink = item.querySelector('a[data-tp-primary="on"]');
        if (!titleLink) return;

        const relUrl = titleLink.getAttribute('href') || '';
        const idMatch = relUrl.match(/\.(\d+)\/?$/);
        const overtake_id = idMatch ? idMatch[1] : '';
        if (!overtake_id) return;

        const title = titleLink.textContent.trim();
        const url = relUrl.startsWith('http') ? relUrl : 'https://www.overtake.gg' + relUrl;
        const author = item.getAttribute('data-author') || '';

        // The listing's icon is a 96x96 resource icon, and the server has no
        // larger variant of it. A mod with no icon falls back to the author's
        // avatar, which the listing links at XenForo's *small* size — 48px.
        // Avatars do come in sizes (s 48 / m 96 / l 192 / o original), so ask
        // for the large one; the frontend applies the same rewrite when
        // reading, so an already-synced catalogue is fixed without a re-sync.
        const avatarImg = item.querySelector('.structItem-iconContainer img');
        const rawSrc = avatarImg ? (avatarImg.src.startsWith('http') ? avatarImg.src : 'https://www.overtake.gg' + avatarImg.src) : '';
        const image_url = rawSrc.replace('/avatars/s/', '/avatars/l/');

        const dlEl = item.querySelector('.structItem-metaItem--downloads dd');
        const download_count = dlEl ? parseInt(dlEl.textContent.replace(/,/g, '') || '0') : 0;
        const dateEl = item.querySelector('.structItem-metaItem--lastUpdate time');
        const last_updated = dateEl ? (dateEl.getAttribute('datetime') || '').split('T')[0] : '';
        const descEl = item.querySelector('.structItem-resourceTagLine');
        const description = descEl ? descEl.textContent.trim() : '';
        const versionEl = item.querySelector('.u-muted');
        const version = versionEl ? versionEl.textContent.trim() : '';

        mods.push({ overtake_id, title, url, author, version, description, image_url, download_count, last_updated });
    });

    let totalPages = 1;
    document.querySelectorAll('.pageNav-page a, .pageNav-jump--last').forEach(link => {
        const match = (link.getAttribute('href') || '').match(/[?&]page=(\d+)/);
        if (match) {
            const p = parseInt(match[1]);
            if (p > totalPages) totalPages = p;
        }
    });

    const bytes = new TextEncoder().encode(JSON.stringify({ mods, totalPages }));
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    window.location.replace('http://tauri.localhost/f1m24-scrape-result?data=' + hex);
})();
"#;

#[derive(Deserialize)]
struct ScrapedMod {
    overtake_id: String,
    title: String,
    url: String,
    author: String,
    version: String,
    description: String,
    image_url: String,
    download_count: i64,
    last_updated: String,
}

#[derive(Deserialize)]
struct ScrapeResult {
    mods: Vec<ScrapedMod>,
    #[serde(rename = "totalPages")]
    total_pages: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStats {
    pub count: usize,
    pub last_sync: String,
}

/// How many mods are cached locally, and when we last refreshed them.
#[tauri::command]
pub fn get_catalog_stats(state: tauri::State<AppState>) -> Result<CatalogStats, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    Ok(CatalogStats {
        count: conn.data.mod_cache.len(),
        last_sync: conn.get_setting("catalog_last_sync").unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn sync_overtake_database(
    deep: Option<bool>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    // A routine sync stops as soon as it reaches pages it already knows; a deep
    // one always walks the lot. See `page_has_news` for why that is safe.
    let deep = deep.unwrap_or(false);

    // Snapshot of what is already cached, taken once: the comparison below runs
    // per mod per page and must not take the lock each time.
    let known: std::collections::HashMap<String, String> = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.data
            .mod_cache
            .values()
            .map(|m| (m.overtake_id.clone(), m.last_updated.clone()))
            .collect()
    };
    if let Some(existing) = app.get_webview_window("scraper") {
        let _ = existing.close();
    }

    let shared_json = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
    let shared_json_clone = shared_json.clone();

    let win = tauri::WebviewWindowBuilder::new(
        &app,
        "scraper",
        tauri::WebviewUrl::External(BASE_URL.parse().map_err(|_| "Invalid catalog URL")?),
    )
    .visible(false)
    .on_navigation(move |url| {
        let url_str = url.as_str();
        if let Some(idx) = url_str.find("/f1m24-scrape-result?data=") {
            let hex_encoded = &url_str[idx + "/f1m24-scrape-result?data=".len()..];
            if let Ok(bytes) = hex::decode(hex_encoded) {
                if let Ok(json_str) = String::from_utf8(bytes) {
                    if let Ok(mut slot) = shared_json_clone.lock() {
                        *slot = Some(json_str);
                    }
                }
            }
            return false;
        }
        true
    })
    .build()
    .map_err(|e| e.to_string())?;

    // Any early exit from here on must close the window.
    let result = run_sync(&app, &state, &win, &shared_json, deep, &known).await;
    let _ = win.close();

    if let Ok(count) = &result {
        if let Ok(mut conn) = state.db.lock() {
            let _ = conn.set_setting(
                "catalog_last_sync".to_string(),
                chrono::Utc::now().to_rfc3339(),
            );
        }
        let _ = app.emit_to("main", "catalog-synced", *count);
    }

    result
}

async fn run_sync(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    win: &tauri::WebviewWindow,
    shared_json: &std::sync::Arc<std::sync::Mutex<Option<String>>>,
    deep: bool,
    known: &std::collections::HashMap<String, String>,
) -> Result<usize, String> {
    let mut current_page = 1usize;
    let mut total_pages;
    let mut total_found = 0usize;
    let mut collected: Vec<ModCache> = Vec::new();

    loop {
        if let Ok(mut slot) = shared_json.lock() {
            *slot = None;
        }

        let mut parsed_json = String::new();
        for i in 0..POLL_ATTEMPTS {
            tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
            // Re-inject every ~450ms until the page has rendered its list.
            if i % 3 == 0 {
                let _ = win.eval(SCRAPE_JS);
            }
            let taken = shared_json.lock().ok().and_then(|mut s| s.take());
            if let Some(json) = taken {
                parsed_json = json;
                break;
            }
        }

        if parsed_json.is_empty() {
            return Err(format!(
                "Timed out reading page {current_page}. Check your internet connection, or re-link your Overtake.gg account in Settings if the site is showing a captcha."
            ));
        }

        let result: ScrapeResult = serde_json::from_str(&parsed_json)
            .map_err(|e| format!("Unexpected catalog format: {e}"))?;

        total_pages = result.total_pages.clamp(1, MAX_PAGES);
        total_found += result.mods.len();

        let had_news = page_has_news(&result.mods, known);

        collected.extend(result.mods.into_iter().map(|m| ModCache {
            overtake_id: m.overtake_id,
            title: m.title,
            url: m.url,
            author: Some(m.author),
            version: Some(m.version),
            description: Some(m.description),
            image_url: Some(m.image_url),
            download_count: m.download_count,
            last_updated: m.last_updated,
        }));

        let _ = app.emit_to(
            "main",
            "sync-progress",
            serde_json::json!({
                "current_page": current_page,
                "total_pages": total_pages,
                "mods_found": total_found
            }),
        );

        // The listing is requested with `order=last_update&direction=desc`, so
        // once a whole page holds nothing new and nothing re-dated, every page
        // after it is older still. Walking the remaining ten pages would only
        // re-read what is already cached — and hammer Overtake for nothing.
        //
        // Guarded by `deep` because this is the one place a wrong assumption
        // would lose data silently rather than loudly: if the site ever stops
        // honouring the sort, "Deep sync" is the way back.
        if !deep && !had_news {
            log::info!("sync: page {current_page} held nothing new, stopping early");
            break;
        }

        current_page += 1;
        if current_page > total_pages {
            break;
        }

        // Be a polite scraper.
        let delay = { rand::thread_rng().gen_range(900..2200) };
        tokio::time::sleep(Duration::from_millis(delay)).await;

        // `navigate` rather than eval, for the same reason downloads use it. The
        // scraper flag does not need clearing: a page load builds a fresh JS
        // context, so `window.__f1m24_scraper_active` is gone with it.
        let next_url = format!("{BASE_URL}&page={current_page}");
        if let Ok(url) = next_url.parse() {
            let _ = win.navigate(url);
        }
    }

    // One single write at the end instead of one per page.
    {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        for m in collected {
            conn.data.mod_cache.insert(m.overtake_id.clone(), m);
        }
        // Catalogue only: a sync never touches the installed library.
        conn.save_catalog()?;
    }

    Ok(total_found)
}

/// Whether a scraped page contains anything the cache does not already have.
///
/// "News" is either a mod we have never seen or one whose last-update date has
/// moved. A page of entries that are all known *and* unchanged means the sync
/// has caught up with itself.
fn page_has_news(
    mods: &[ScrapedMod],
    known: &std::collections::HashMap<String, String>,
) -> bool {
    mods.iter().any(|m| match known.get(&m.overtake_id) {
        Some(cached_date) => cached_date != &m.last_updated,
        None => true,
    })
}

/// Paginated search over the locally cached catalog.
#[tauri::command]
pub fn search_mods(
    query: String,
    limit: i32,
    offset: i32,
    sort: Option<String>,
    state: tauri::State<AppState>,
) -> Result<Vec<ModCache>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    let q = query.trim().to_lowercase();

    // Collect references first — only the requested page is ever cloned.
    let mut matches: Vec<&ModCache> = conn
        .data
        .mod_cache
        .values()
        .filter(|m| {
            q.is_empty()
                || m.title.to_lowercase().contains(&q)
                || m.author.as_ref().is_some_and(|a| a.to_lowercase().contains(&q))
                || m.description.as_ref().is_some_and(|d| d.to_lowercase().contains(&q))
        })
        .collect();

    // Ties are broken deterministically so paging never repeats or skips a row.
    match sort.as_deref() {
        Some("downloads") => matches.sort_unstable_by(|a, b| {
            b.download_count
                .cmp(&a.download_count)
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        }),
        Some("name") => matches.sort_unstable_by(|a, b| {
            a.title
                .to_lowercase()
                .cmp(&b.title.to_lowercase())
                .then_with(|| a.overtake_id.cmp(&b.overtake_id))
        }),
        // Default: newest first, which is how the catalogue is scraped.
        _ => matches.sort_unstable_by(|a, b| {
            b.last_updated
                .cmp(&a.last_updated)
                .then_with(|| b.download_count.cmp(&a.download_count))
        }),
    }

    let skip = offset.max(0) as usize;
    let take = limit.clamp(1, 200) as usize;

    Ok(matches.into_iter().skip(skip).take(take).cloned().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn scraped(id: &str, last_updated: &str) -> ScrapedMod {
        ScrapedMod {
            overtake_id: id.into(),
            title: "x".into(),
            url: "https://www.overtake.gg/downloads/x.1/".into(),
            author: String::new(),
            version: String::new(),
            description: String::new(),
            image_url: String::new(),
            download_count: 0,
            last_updated: last_updated.into(),
        }
    }

    /// The stopping rule decides when a sync gives up walking pages, so a
    /// mistake here does not fail loudly — it silently misses mods. Both
    /// directions are pinned.
    #[test]
    fn a_page_of_known_unchanged_mods_is_where_a_sync_stops() {
        let known = HashMap::from([
            ("1".to_string(), "2026-08-01".to_string()),
            ("2".to_string(), "2026-07-30".to_string()),
        ]);

        assert!(
            !page_has_news(&[scraped("1", "2026-08-01"), scraped("2", "2026-07-30")], &known),
            "everything already cached and unchanged"
        );

        assert!(
            page_has_news(&[scraped("1", "2026-08-01"), scraped("3", "2026-06-01")], &known),
            "an id we have never seen is news, even with an older date"
        );

        assert!(
            page_has_news(&[scraped("1", "2026-08-09")], &known),
            "a known mod with a moved date is news"
        );

        assert!(page_has_news(&[], &known) == false, "an empty page holds no news");
    }
}
