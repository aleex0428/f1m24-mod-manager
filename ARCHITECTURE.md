# Architecture

How the app is put together, and the invariants that are easy to break by
accident. Most of the rules below exist because breaking them produced a real
bug that was hard to diagnose — the reasoning is kept so it is not repeated.

## Architecture
- **Framework:** Tauri v2
- **Backend:** Rust (`src-tauri/src/`)
- **Frontend:** React + TypeScript + Vite (`src/`)
- **State:** Zustand (`src/store/modStore.ts`) — always read it through selectors
- **Styling:** Tailwind CSS, dark "race console" theme (tokens in `tailwind.config.js`,
  component classes in `src/index.css`)
- **Persistence:** JSON file (`mods.json`) in the app data dir, guarded by a
  `std::sync::Mutex` (`src-tauri/src/db.rs`)
- **Target OS:** Windows 10/11 (the app manifest requests Administrator so it can
  write into Program Files)

## Download pipeline (the part that is easy to break)
Downloads run through the hidden **ghost webview** (`overtake_ghost`) so requests
carry the user's real Cloudflare/session cookies.

```
start_download_job()        → AppState.pending_download = Some(job)
DownloadEvent::Requested    → job moves into AppState.active_downloads (keyed by
                              destination path) and the byte monitor starts
DownloadEvent::Finished     → monitor stops → verify → install → temp dir removed
```

Invariants:
- A job lives in **exactly one** of `pending_download` / `active_downloads`.
  `Requested` moves it; it must not be consumed there, or `Finished` can never
  install it (this was the original "downloads never install" bug).
- Every terminal path (success, failure, watchdog timeout, cancel, auth wall)
  clears the job **and** sets its monitor `stop` flag, otherwise the byte monitor
  polls forever and the serial queue stalls.
- Backend → UI events use `downloader::emit_ui` (`emit_to("main", …)`), never a
  broadcast `emit`, so the ghost/scraper webviews are not woken up.
- Progress events are only emitted when the byte count actually changed.

Event contract: `download-started` → `download-progress` → `download-status`
(`connecting` | `verifying` | `installing`) → `download-finished` | `download-error`.
The error string `AUTH_REQUIRED` is special: the frontend parks the job as
`login_required`, pauses the queue, and resumes automatically on `auth-status`.

## Overtake.gg session (`auth.rs`)
The session lives in the ghost webview's WebView2 cookie jar, not in our DB —
`mods.json` only mirrors it so the UI can render without touching the webview.

- **Never infer a successful login from a URL.** XenForo submits its login form
  over XHR (often no page load at all), and the OAuth "Continue with Google →
  Confirm" step is served *from overtake.gg while the visitor is still a guest*
  — a URL-based guess reports a login that never happened. That exact bug shipped
  once; do not reintroduce it.
- Detection is a watcher thread that, every 1.2 s: `eval`s `PROBE_JS` (which asks
  the page whether it renders as a member and mirrors the answer into the
  first-party `f1m24_state` **session** cookie), then reads the cookie jar for
  `xf_user` (persistent login) or `f1m24_state=1` (this-session login). The probe
  is non-destructive, unlike the scraper's redirect trick — it must never
  navigate away from a form the user is filling in.
- `f1m24_state` is a session cookie on purpose: a persisted one could survive
  into the next run and fake a session that is already gone.
- Loading a login wall calls `mark_logged_in(false)`: proof we are not authed.
- `start_download_job` pre-flights `session_likely_valid()` so a missing session
  fails immediately instead of burning the 30 s watchdog.
- `cookies_for_url()` / `clear_all_browsing_data()` **deadlock if called on the
  main thread** (wry#583). Always call them from `std::thread::spawn` or
  `spawn_blocking`, never from a sync command or an event handler.
- An unreadable cookie store returns `None` and must never be treated as
  "signed out", or a flaky read logs the user out of a working session.
- `auth-required` (the sign-in modal) is only emitted when an auth wall actually
  interrupted a download — `abort_for_auth()` returns whether it did.
- Hiding/closing the login window clears `awaiting_login`, so a later page load
  cannot be mistaken for a successful sign-in.

## Paths
Steam's registry stores its install dir with **forward slashes**
(`c:/program files (x86)/steam`), so a detected game path arrives with mixed
separators. Rust's file APIs accept it, but `explorer.exe` cannot parse it and
silently opens the user's Documents folder instead — which looked exactly like
"the folder button is broken". Everything goes through
`game_detector::normalize_path()`, and folders are opened with
`game_detector::open_in_explorer()`. The stored setting is migrated at startup.

Downloaded archives: `%TEMP%\f1m24-mod-manager\<jobId>\` while installing, then
a copy in `<app_data>\archives\` when "Keep downloaded archives" is on. Only the
`.pak` (+ `.ucas`/`.utoc`/`.sig`) files ever reach the game folder.

## Mod files on disk
`~mods` naming, all handled in `mod_manager.rs`:
```
pakchunk99-WindowsNoEditor.pak                 base = pakchunk99-WindowsNoEditor
pakchunk99-WindowsNoEditor_300_P.pak           load-order priority 300
pakchunk99-WindowsNoEditor_300_P.pak.disabled  disabled
```
- `.ucas` / `.utoc` / `.sig` siblings always move, rename and delete together
  with their `.pak`.
- **Two or more folders holding a `.pak` means the archive ships alternatives**
  ("COLORED VERSION" / "WHITE VERSION"). Detection is by folder, not by name
  clash: real archives give each alternative a *different* file name, so they
  do not overwrite each other — they all install and then fight over the same
  thing in game. The first attempt looked for name clashes and detected nothing
  on real mods. The extraction is parked in `AppState.pending_installs`, the UI
  asks, and `resolve_install_variant` finishes it.
- Alternatives are also shipped loose in one folder, with no layout to go by.
  There the signal is the pakchunk: two `.pak` files claiming the same chunk
  cannot both apply — the same clash `detect_conflicts` reports between
  installed mods. Picking one keeps every uncontested file, since those are
  shared parts rather than options.
- Sibling folders and same-chunk files are sometimes parts of one mod rather
  than alternatives, and nothing in the archive says which. The picker
  therefore always offers "install everything" (`VARIANT_ALL`), so the guess
  is never destructive.
- Variant ids carry their kind: `dir:<path>`, `pak:<base>` or `*`.
- A single-folder mod and a multi-part mod (`.pak` + `.ucas` + `.utoc`) must
  never trigger the picker; there are tests for both, and for the real
  leaderboard archive shape.
- A parked install owns the download slot (`awaiting_input` counts as active)
  and is dropped after 10 minutes, so an unanswered question cannot wedge the
  queue.
- Higher `_NNN_P` wins, so the **top** of the load-order list gets the highest
  number and overrides everything below it.
- `base_of()` / `strip_priority_suffix()` are covered by unit tests — run
  `cargo test --lib` after touching them.

## Performance notes
- The store is subscribed to with selectors; `useDownload` drives the queue via
  `useModStore.subscribe` so download progress never re-renders the app tree.
- Catalog rows subscribe to their own job status only, and use `.cv-auto`
  (`content-visibility`) instead of a virtualization library.
- `backdrop-filter` is reserved for modals — never put it on list items.
- No remote fonts/stylesheets: the CSP is `default-src 'self'`, so external
  links only cost failed requests.

## Releasing
Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds, signs and
opens a draft GitHub release including `latest.json`.

- `bundle.createUpdaterArtifacts` is on, so **any release build needs
  `TAURI_SIGNING_PRIVATE_KEY` in the environment or it fails**. Locally the key
  is at `%USERPROFILE%\.tauri\f1m24-updater.key`; in CI it is a repository
  secret. It must never be committed (`.gitignore` covers `*.key`), and losing
  it means no user can ever receive another update.
- `updater.endpoints` points at the real repository so local builds can update
  too; the workflow rewrites it to `github.repository` anyway, so a fork or a
  rename keeps working without touching the config.
- The version must match in `package.json`, `Cargo.toml` and `tauri.conf.json`;
  the workflow refuses to build otherwise.

## Commands
- **Dev:** `npm run tauri dev`
- **Build:** `npm run tauri build`
- **Frontend check:** `npm run build` (runs `tsc` first)
- **Backend check:** `cd src-tauri && cargo test --lib`
