# Changelog

All notable changes to F1M24 Mod Manager are documented here.

## [1.0.1] — unreleased

### Added

- **Version picker for archives with alternatives.** Many mods ship several
  interchangeable versions in one download — "COLORED VERSION" next to
  "WHITE VERSION", or one folder per livery. The install now stops and asks
  which one you want, whether the mod came from the catalogue or from a local
  file. When the folders turn out to be parts of a single mod rather than
  options, "Install everything" is always offered.
- **Install from a link.** Paste any Overtake.gg mod page into Browse to queue
  it, for mods newer than your last catalogue sync.
- **Open a mod's Overtake.gg page** from its row in the catalogue, so you can
  read the description and comments before installing.
- **Catalogue sorting**: recently updated, most downloaded, or by name.
- **Stale catalogue warning.** After 14 days without a sync, Browse says so and
  offers to refresh — until then, update checks quietly miss new releases.
- **A way out when an update check fails.** The error now explains itself and
  links to the downloads page instead of showing a raw message.

- **Its own title bar.** The window controls now live inside the app header
  instead of a separate Windows frame, so the app looks like one piece and
  gains back the strip of height the system bar used.
- **Conflicts say who wins.** A contested mod is marked "Applied" or
  "Overridden by <mod>", so the warning tells you what is actually happening
  instead of only that something is wrong.
- **Enable or disable every mod at once**, from the library header — the first
  thing you want before a game update, or when hunting down which mod broke
  something.
- **Buttons to move a mod up or down** the load order, for when dragging across
  a long list means fighting the scroll.
- **Each mod shows what it takes up on disk.**
- **Keyboard shortcuts**: `Ctrl+F` jumps to the search box, `Ctrl+1/2/3` switch
  between My Mods, Browse and Settings.
- **A "what's new" panel after updating**, so a silent background update no
  longer changes things without saying what.

- **Drop a mod on the window to install it.** Dragging a .zip, .rar, .7z or
  .pak onto the app installs it, several at a time if you like — including the
  question about which version to use when the archive holds alternatives.
- **Download progress on the taskbar icon**, so a large mod can be watched
  without keeping the window in front.
- **Act on a mod from its details.** The panel used to be read-only: enabling,
  updating and uninstalling now happen there instead of closing it and hunting
  for the row again.

### Improved

- **Toggling a mod writes 5 KB instead of 227 KB.** The scraped catalogue moved
  out of the library file into `catalog.json`, so enabling or disabling a mod no
  longer rewrites hundreds of kilobytes of unrelated data. Existing libraries
  are migrated on first start, keeping a `mods.json.bak` copy.
- **Clearer message when a download is not a mod.** An archive containing an
  application now says so, rather than reporting that no mods were found.
- **The library reloads once per install**, not once per open view.
- **Rows fade in** as they appear, instead of snapping into place.
- **Only the NSIS installer is published.** The MSI added 40% to the download
  size and a second option nobody needed.
- Updates are now published from a second, independent copy of the manifest on
  GitHub Pages, so a release URL that cannot be reached no longer means no
  updates. Releases also verify that the update endpoint actually responds
  before publishing, and build the Overtake.gg archive automatically.

### Fixed

- **Downloads could hang on "Connecting" forever.** The download was started by
  injecting a script into the hidden browser window, which silently does
  nothing until a page has been loaded there. Anyone whose session was restored
  from a saved cookie — that is, anyone who did not sign in again that session —
  could not download anything. It now drives the window directly.
- **Archives with several versions installed all of them at once**, leaving
  several mods fighting over the same thing in game. Detection looked for files
  with identical names, but real archives give each version a different name, so
  nothing was ever detected.
- **Alternatives shipped loose in one folder** are now detected too, by spotting
  two files that claim the same pakchunk.
- **Choosing a version for a local file did not refresh the library.** The mod
  installed correctly but only appeared after switching tabs.
- The last Spanish error message is now in English, like the rest of the app.

## [1.0.0] — 2026-08-12

First public release.

- Browse and search the Overtake.gg catalogue for F1 Manager 2024
- One-click install: downloads through a real browser session, unpacks the
  archive and copies the `.pak` files into the game
- Enable and disable mods without deleting them
- Drag to set load order; the mod at the top overrides the ones below
- Conflict detection when two active mods claim the same pakchunk
- Update checking against the catalogue
- Launch the game, with a warning when conflicts are unresolved
- Self-updating
