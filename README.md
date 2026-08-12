# F1M24 Mod Manager

A desktop mod manager for **F1 Manager 24** on Windows. Browse the Overtake.gg
catalog, install mods in one click, control load order, and spot conflicts
before they break your save.

![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4)

## Features

- **Browse Overtake.gg** — the F1 Manager 2024 downloads section is synced to a
  local catalog you can search offline.
- **One-click install** — downloads through a real browser session, so Cloudflare
  and login walls are handled instead of failing silently. Archives (`.zip`,
  `.rar`, `.7z`) are unpacked automatically; only the `.pak` files reach the game.
- **Enable / disable without deleting** — toggling renames files in place, so a
  mod can be parked and brought back instantly.
- **Load order** — drag to reorder; the mod at the top overrides the ones below.
- **Conflict detection** — warns when two active mods claim the same pakchunk,
  with a compatibility matrix.
- **Update checking** — compares your installed versions against the catalog.
- **Launch the game** from the app, with a warning if conflicts are unresolved.

## Requirements

- Windows 10 or 11 (64-bit)
- F1 Manager 24 (Steam, Epic or EA App)
- A free [Overtake.gg](https://www.overtake.gg) account to download mods
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) — already
  present on any up-to-date Windows 10/11

## Install

Download `F1M24 Mod Manager_<version>_x64-setup.exe` from the releases page and
run it.

> The installer is not code-signed yet, so SmartScreen will show
> "Windows protected your PC" → **More info** → **Run anyway**.
>
> The app requests Administrator rights because mods must be written into the
> game folder, which usually lives under `Program Files`.

## First run

1. **Point to your game** — the folder containing `F1Manager24.exe`. It is
   auto-detected from Steam, Epic and the registry; pick it manually if not.
2. **Link your Overtake.gg account** — a real browser window opens on
   overtake.gg. Tick *"Stay signed in"* so the session survives restarts. The
   app never sees your password; only the browser session cookie is kept, on
   your PC.
3. **Sync the catalog** in the Browse tab.

## Where files go

| What | Where |
| --- | --- |
| Installed mods | `<game>\F1Manager24\Content\Paks\~mods\` |
| Downloaded archives | `%APPDATA%\gg.overtake.f1m24-mod-manager\archives\` |
| Library & settings | `%APPDATA%\gg.overtake.f1m24-mod-manager\mods.json` |
| Temporary downloads | `%TEMP%\f1m24-mod-manager\` (cleared on every start) |

Closing the window keeps the app in the system tray so downloads can finish;
right-click the tray icon to quit, or turn that off in Settings.

## Updates

The app checks for a new release a few seconds after launch. If one exists you
get a notification and an *Update available* link in the sidebar; installing it
from **Settings → Check for updates** downloads, verifies the signature and
restarts the app. A failed check is silent by design — an unreachable endpoint
must never nag the user.

## Building from source

```bash
npm install
npm run tauri dev     # development
npm run tauri build   # installers in src-tauri/target/release/bundle
```

Checks:

```bash
npm run build                       # typecheck + frontend build
cd src-tauri && cargo test --lib    # backend unit tests
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for architecture notes and the invariants to respect
when changing the download or session code.

### Releasing a new version

Releases are automated by [`.github/workflows/release.yml`](.github/workflows/release.yml).

**One-time setup**

1. Push this project to GitHub.
2. Add a repository secret named `TAURI_SIGNING_PRIVATE_KEY`
   (*Settings → Secrets and variables → Actions → New repository secret*) with
   the contents of `%USERPROFILE%\.tauri\f1m24-updater.key`:

   ```powershell
   Get-Content "$env:USERPROFILE\.tauri\f1m24-updater.key" | Set-Clipboard
   ```

   No password secret is needed — the key was generated without one.

**Every release**

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` — all three must match, and the workflow fails
   fast if they don't.
2. Tag and push:

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

The workflow then builds, runs the tests, signs the installer, generates
`latest.json` and opens a **draft** release. Review it, hit *Publish*, and every
running copy of the app picks the update up on its next launch.

The workflow rewrites the updater endpoint to whichever repository it runs in,
so forks and renames keep working with no config changes.

### Releasing from your own machine

Needed when GitHub Actions is unavailable — for example when a run fails
instantly with *"the job was not started because your account is locked"*.

```bash
npm run release            # build, sign, write latest.json, open a draft release
npm run release -- --dry-run   # run every check without building
```

The script refuses to continue if the three version numbers disagree, if the
signing key is missing, if `gh` is not authenticated, if the release already
exists, or if the updater endpoint does not point at this repository. Then
review the draft and publish it:

```bash
gh release edit v1.0.1 --draft=false
```

Until the release is published, `/releases/latest/download/latest.json` does not
resolve and nobody receives the update.

> The signing key is the one thing that cannot be recreated. If it is lost,
> published updates can no longer be verified and every user has to reinstall
> by hand. Keep a copy somewhere safe, and never commit it.

## Troubleshooting

**Downloads stay at "Sign-in required"** — the Overtake session expired. Open
Settings → *Verify*, then re-link the account.

**The catalog sync times out** — Overtake.gg is showing a Cloudflare challenge.
Re-link your account; the challenge is solved in that same window.

**A mod installs but nothing changes in game** — check the Library for a
conflict badge: two mods claiming the same pakchunk means only the top one in
the load order is applied.

## Disclaimer

Not affiliated with Overtake.gg, Frontier Developments, or Formula 1. Mods are
downloaded from Overtake.gg under your own account; all credit belongs to their
authors.
