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
- **Install by dropping a file** on the window, or from a link you paste.
- **Pick a version** when an archive ships several alternatives, instead of
  installing all of them on top of each other.
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
| Mod catalogue | `%APPDATA%\gg.overtake.f1m24-mod-manager\catalog.json` |
| Temporary downloads | `%TEMP%\f1m24-mod-manager\` (cleared on every start) |

Closing the window keeps the app in the system tray so downloads can finish;
right-click the tray icon to quit, or turn that off in Settings.

## Updates

The app checks for a new release a few seconds after launch. If one exists you
get a notification and an *Update available* link in the sidebar; installing it
from **Settings → Check for updates** downloads, verifies the signature and
restarts the app. A failed check is silent by design — an unreachable endpoint
must never nag the user.

## Disclaimer

Not affiliated with Overtake.gg, Frontier Developments, or Formula 1. Mods are
downloaded from Overtake.gg under your own account; all credit belongs to their
authors.
