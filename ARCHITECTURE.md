# Architecture

How the app is put together, and the invariants that are easy to break by
accident. Most of the rules below exist because breaking them produced a real
bug that was hard to diagnose — the reasoning is kept so it is not repeated.

## Stack
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
- **Drive the ghost webview with `navigate()`, never by eval'ing
  `window.location`.** It sits on `about:blank` until something loads a page in
  it, and script injected into `about:blank` is silently dropped — the transfer
  never starts and the job hangs on "connecting" until the watchdog fires.
  Anyone whose session was restored from a cookie, rather than by signing in
  that session, hit this on every download.

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

## Data files
`%APPDATA%\gg.overtake.f1m24-mod-manager\`:

```
mods.json           installed library + settings. Small, rewritten on every
                    toggle, install and preference change.
catalog.json        the scraped Overtake listing, ~190 KB. Written only on sync.
archives\           a copy of each installed archive, while the setting is on.
.window-state.json  window geometry (see Window chrome).
```

`db.rs` presents both files as one in-memory `AppDatabase`, so callers never
care which file a field lives in. `save()` writes the library, `save_catalog()`
the catalogue: a sync must not call `save()` and a toggle must not call
`save_catalog()`, or the split buys nothing.

A pre-1.0.1 database keeps the catalogue inside `mods.json`; it is migrated on
first start and the original is kept as `mods.json.bak`. An unreadable
`mods.json` is renamed to `mods.corrupt.json` rather than quietly replaced —
losing a library is worse than refusing to start clean.

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

## Frontend ↔ backend contract
Three traps, each of which shipped a bug:

- **`rename_all` on an enum renames the variants, not the fields inside them.**
  `InstallOutcome` carries `#[serde(rename_all = "camelCase")]` on every variant
  as well. Without it the payload says `staging_id` while the UI reads
  `outcome.stagingId`, and the variant picker cannot complete. A test asserts
  the exact JSON the UI consumes.
- **`getCurrentWindow()` and `getCurrentWebview()` throw *synchronously*** when
  the app is not running inside Tauri, so a `.catch()` on the promise they
  would have returned never fires. Called straight from an effect, that throw
  unmounts the whole tree and leaves a blank window — it happened twice before
  being centralised. Always resolve them through `tauriHandle()` in
  `src/lib/tauri.ts`.
- **`mod-installed` has exactly one owner**: `install_mod`, on success. A second
  emitter double-reloads the library; no emitter means an install path where the
  list never updates. `resolve_install_variant` finishes through `install_mod`,
  so it is covered.

Command arguments are camelCase in JS and snake_case in Rust; Tauri converts
between them. After a batch of changes it is worth re-checking every `invoke`
against its command signature and every listened event against its emitter —
both mismatches fail only at runtime, and only on the path that uses them.

## Window chrome
The system frame is off (`decorations: false`); the app draws its own controls
in the header, and dragging comes from `data-tauri-drag-region`.

`tauri-plugin-window-state` is configured with `SIZE | POSITION | MAXIMIZED`
only. Its defaults also persist `DECORATIONS` and `VISIBLE`, and both are
traps: a `decorated: true` saved by an older build restores the system title
bar on top of the app's own one, and `visible: false` — written every time the
window is closed to the tray — would start the app with no window at all.

## Interface system
Visual values are defined once, in `tailwind.config.js`, and used through their
names: the type scale (`text-2xs` … `text-3xl`, 11px floor), `duration-fast|
base|slow` with `ease-out-expo`, `shadow-elev-0..3`, and the `z-menu < z-drawer
< z-modal < z-palette < z-dropzone` ladder. A component that needs a value the
scale does not have should extend the scale, not write `text-[13px]`.

- Icons come from `src/components/Icon.tsx` and nowhere else. Pasting an SVG
  inline is how the same glyph ended up at five stroke weights across the app.
  The exception is `WindowControls`, whose 10×10 glyphs are Windows chrome
  metrics rather than app icons.
- **`.stagger` uses `animation-fill-mode: backwards`, never `both`.** A
  finished animation that keeps its final frame outranks inline styles in the
  cascade, and library rows carry a drag transform set inline by dnd-kit —
  with `both`, picking a row up snaps it back to `translateY(0)` and dragging
  looks broken. `backwards` holds only the *starting* frame, during the delay.
- Every dialog goes through `src/components/Modal.tsx`, which owns
  `role="dialog"`, the focus trap, focus restore and Escape. `dismissable=
  false` is for a dialog that owns state which has to be released explicitly —
  the variant picker holds a parked extraction and the download slot with it.
- Interface preferences (view mode, density, sidebar) live in `localStorage`
  via `usePreference`, not in `mods.json`: they must be readable synchronously
  on first render, and a view toggle has no business rewriting the mod
  database.
- Actions that belong to a page are triggered from elsewhere by dispatching a
  window event (`app:focus-search`, `app:sync-catalog`, `app:install-file`,
  `app:check-updates`) and handled where they live. The palette navigates and
  dispatches; it does not carry a second copy of the implementation.

## Mod pictures
The catalogue's only image is the XenForo **resource icon: 96×96, with no
larger variant on the server** — `/l/`, `/o/` and a `_full` suffix all 404.
Measure before assuming otherwise; the grid was built on the assumption that
these were cover art and enlarged them threefold.

- Everything that shows a mod's picture goes through `ModCover`, which draws
  the image at its intrinsic size over a blurred, scaled copy of itself. The
  mechanism is `max-width`/`max-height` with **no** `width`/`height`: an image
  with only maximums renders at its own size and shrinks to fit, but can never
  grow. Replacing those with `w-full h-full object-cover` restores the original
  bug exactly.
- `mode="fill"` is only correct where the box is *smaller* than 96px — the 64px
  row thumbnail. Anywhere else it upscales.
- The blur is `filter`, not `backdrop-filter`. The rule against
  `backdrop-filter` on list items still stands: it forces a read of the
  composited backdrop. A `filter` on a 96px image is cheap, and
  `cv-auto-tile` keeps offscreen tiles from painting at all.
- The backdrop's base scale is a **class**, not an inline style — an inline
  `transform` outranks the `group-hover:` utility and the card stops reacting.
- Mods with no image get a poster generated from the name (`initialsFor`,
  `hueFor` in `src/lib/images.ts`). Both are deterministic on purpose: a card
  that changes colour between launches is worse than a grey one.
- `bestImageUrl` rewrites `/avatars/s/` (48px) to `/avatars/l/` (192px) for the
  mods that fall back to an author avatar. It runs on **read**, so a catalogue
  already on disk is fixed without a re-sync, and the scraper applies the same
  rewrite on write so new data is born correct. A missing variant just 404s
  into the generated poster.

## Writing into `~mods`
Every operation the app performs on the game folder is a rename, a move or a
delete of a `.pak` the game **memory-maps while it runs**. Windows refuses those
on an open file, so an operation attempted mid-session fails *partway*: some
files in a group renamed, some not — the one state the naming scheme cannot
describe.

- `game_detector::ensure_game_closed()` guards every such command:
  `install_mod`, `toggle_mod`, `set_all_mods_enabled`, `apply_load_order`,
  `delete_mod`, `restore_mod`, `resolve_install_variant`, `apply_profile`. A new
  command that touches the folder must call it too — one helper, so the wording
  is identical wherever it is hit.
- `is_game_running()` caches its answer for 1.5 s. Enumerating processes costs
  tens of milliseconds and `set_all_mods_enabled` calls `toggle_mod` once per
  mod; without the cache, sixty mods meant sixty full scans.
- Matched on the exact executable name. A `contains` would lock the user out of
  their own mod folder on a false positive, which is worse than the race the
  guard prevents. The guard is best-effort by design.

## Library versus disk
The library records what *was* installed; the folder is edited by game updates
and by hand. Two checks, split by cost:

- **Presence** runs on every `get_mods`, because it reads the directory listing
  the size calculation already needs. Produces `missing` / `incomplete`.
- **Checksums** run only from `verify_mods`, because that means re-reading
  hundreds of megabytes. The result is *not* persisted — it is a snapshot of one
  check, so the UI applies `modified` to the ids it returns.
- `integrity_from_presence` is pure and tested. The cases that matter are the
  ones that must not raise an alarm: no game path configured, and a record that
  names no files.

## Profiles
A profile stores the **complete** list of mods to enable, not a set of additions.
Anything it does not name is disabled when it is applied. That is what makes it
a state you can return to, and the only way "Clean (no mods)" can exist — but it
also surprises people, so the UI confirms before an apply that would disable
something.

- Stored in `mods.json`: small, and switching profiles rewrites the library
  anyway, so it costs nothing the catalogue split was protecting.
- Mods installed since a profile was saved are appended to the **end** of its
  order. Inserting them anywhere else would let a new mod silently outrank a
  deliberate arrangement.
- `apply_profile` skips `apply_load_order` entirely when the resulting order
  already matches — that call renames every mod file, and running it for nothing
  is pure churn on a folder that can hold hundreds.

## Sharing a profile
The exported file carries **references, not files**: each mod's Overtake page,
version and position. Bundling the `.pak` files would redistribute other
people's work without asking and route users around the download counts their
authors are judged by.

- Mod ids are local to an installation, so matching an imported profile against
  the local library is done **by Overtake URL**. `normalise_url` is what makes
  that comparison reliable — the queue stores the `/download` form while the
  catalogue stores the page — and it is tested, because a mismatch silently
  re-downloads something the user already has.
- Importing is read-only until the user acts: `preview_shared_profile` reports,
  `import_shared_profile` only saves a profile. Downloading and applying are
  separate. Opening a file someone sent you must not rearrange a mod folder.
- The file picker lives in Rust, like every other dialog here, so the frontend
  still needs no filesystem permission — see `capabilities/default.json`, which
  states that rule.
- `format` is versioned from day one, and a file from a newer version is
  refused with an explanation rather than half-parsed.

## Adding a field to `ModRecord`
**Every new field needs `#[serde(default)]`.** A `mods.json` written by an older
build has no such key, and `DbStore` renames a library it cannot parse to
`mods.corrupt.json` and starts empty — so a missing attribute turns an app
update into what looks exactly like losing your library. `db.rs` has a test
pinning the pre-1.1 shape; keep it passing.

Anything the *user* authored (notes, favourites) must also survive a mod being
updated, which deletes the old record and writes a new one. `install_groups`
reads those fields before the delete and carries them across.

## Library sorting versus load order
The list has two orderings and they are not the same thing. `localOrder` is the
load order — what the game obeys, what a profile stores, what dragging edits.
`LibrarySort` only decides how the list is *shown*.

Dragging is disabled unless the view is in load order (and unfiltered, and not
in grid), because dropping row 3 above row 1 while sorted by name would move the
mod somewhere the user cannot see. Selection follows the visible list, so
Shift-click and Ctrl+A always mean what is on screen.

## Catalogue sync
The listing is requested with `order=last_update&direction=desc`, so once a
whole page contains nothing new and nothing re-dated, every page after it is
older still — that is what licenses the early exit. `page_has_news` is the rule
and it is tested, because a mistake there does not fail loudly, it silently
misses mods. `sync_overtake_database(deep: true)` always walks everything, and
is the way back if the site ever stops honouring the sort.

## Downloads cannot resume
Tauri's `DownloadEvent` exposes only `Requested { url, destination }` and
`Finished { url, path, success }` — no handle on the transfer, no `Range`
header, no pause. WebView2 has it natively; it is not surfaced. Resuming would
mean replacing the ghost webview with our own HTTP client, which would lose the
Cloudflare session that makes downloading work at all.

So a failed download **restarts**. `useDownload` retries twice with a backoff,
and the job stays in `error` for the wait rather than `queued` — the pump starts
anything queued the moment a slot frees, so queueing it would retry instantly
and the backoff would be decorative.

## Logging
`tauri-plugin-log` writes to the log dir and stdout. **The webview target is
deliberately absent**: it would capture console output from the ghost webview,
which is where the Overtake session lives. `diagnostics.rs` reports session
state as a bare yes/no for the same reason — that text is written to be pasted
in public.

## Uninstall and undo
`delete_mod` takes an `undoable` flag. With it, the mod's files are **moved**
into `<mods_dir>/.f1m24-undo/<modId>/` and its record is written beside them as
`mod.json`; `restore_mod` moves them back and reinserts the record.

- The bin sits inside `~mods` because a move within one folder is instant and
  cannot fail when the game is on a different drive from `%APPDATA%` — which a
  copy into the app data folder would.
- Every trashed file gains a `.deleted` suffix, so nothing in the bin still
  looks like a loadable `.pak` to the game. `read_mod_files` only scans
  top-level files, so the folder is invisible to the app as well; there is a
  test for both halves.
- The bin is emptied at startup. Undo is a second thought within a session, not
  a recycle bin that grows inside someone's game folder.
- The internal call that retires the old copy of a mod being updated passes
  `None`: those files are superseded, not lost.

## Performance notes
- The store is subscribed to with selectors; `useDownload` drives the queue via
  `useModStore.subscribe` so download progress never re-renders the app tree.
- Catalog and library tiles subscribe to their own job status only, and use
  `.cv-auto` / `.cv-auto-tile` (`content-visibility`) instead of a
  virtualization library.
- `HeaderDownloads` is a component of its own precisely so the progress ticks
  re-render that strip and nothing else. It selects **primitives** from the
  store; a selector returning a fresh object would re-render on every write.
- `backdrop-filter` is reserved for modals — never put it on list items.
- No remote fonts/stylesheets: the CSP is `default-src 'self'`, so external
  links only cost failed requests.

## Tests
`cargo test --lib` covers what is easy to get subtly wrong and impossible to
eyeball: filename parsing, variant detection, the database migration, update
comparison, and the JSON shape the UI consumes.

Read the variant tests before touching detection. The first implementation
looked for files with identical names, passed the test written alongside it,
and detected nothing at all on a real archive — because real archives give each
alternative a different name. The tests now model shapes taken from actual
downloads, including the ones that must **not** trigger the picker.

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
- **Build:** `npm run tauri build` (needs `TAURI_SIGNING_PRIVATE_KEY`)
- **Release from this machine:** `npm run release`, or `-- --dry-run` for the
  checks alone
- **Frontend check:** `npm run build` (runs `tsc` first)
- **Backend check:** `cd src-tauri && cargo test --lib`
