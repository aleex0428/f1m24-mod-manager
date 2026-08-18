# Changelog

All notable changes to F1M24 Mod Manager are documented here.

## [1.1.0] — unreleased

### Added

- **Profiles.** Save the mods you have active, and the order they load in,
  under a name — "Season 2026", "Classics", "Clean" — and switch between them
  in one click. A profile is the complete list of what should be on, so
  switching to one turns off anything it does not include; nothing is ever
  deleted, and the app says what changed. Mods installed since a profile was
  saved keep their place at the end of the order rather than jumping ahead of
  the arrangement you built.
- **A warning when the game has been patched.** F1 Manager updates break mods
  built for the previous build, and until now the app said nothing. It notices
  the executable has changed and offers to disable everything so you can find
  out which mod is the problem — or start the game and see.
- **Share a profile.** Export one to a small file — the Overtake.gg link,
  version and order of each mod — and send it to someone. Opening it shows what
  they already have, what would be downloaded and what cannot be fetched,
  before anything is touched: the profile is saved, and downloading and
  applying stay separate decisions. The file never contains the mods
  themselves, so nobody's work gets redistributed and every download still goes
  through its author's page.
- **You can see what the load order is doing.** A mod that is switched on but
  covered by another now says so on its own row — an amber marker instead of
  the red one, and a badge pointing at the row number that beats it. Being
  enabled and having no effect is the state people misread most often, and
  until now it was something you worked out from a number and a sentence.
- **Your own tags on a mod**, with a filter row and suggestions drawn from tags
  you have already used.
- **Notes and favourites.** Write yourself a note on any mod — why it is
  disabled, what it clashed with — and pin the ones you care about. Both
  survive updating the mod, because a note belongs to the mod rather than to
  the version of it you happen to have installed.

### Improved

- **The bars above the list no longer crowd it out.** Notices had grown to the
  point where a patched game, missing files and pending updates could stack
  twelve strips deep and leave a small window with almost no room for the mods
  themselves. They share one strip now, which collapses to a count — while
  anything that explains why a control is greyed out keeps its own row, because
  a disabled button whose reason is hidden is just a broken button. Filters and
  tags share a row, and the summary folds to a single line.
- **Conflicts are readable again.** The compatibility matrix was one column per
  contested chunk and became a sideways-scrolling grid of dots the moment you
  had a few. It is a list now, grouped by chunk, naming which mod wins and
  which are having no effect.
- **Dragging a mod shows what you are holding**, a floating copy that follows
  the cursor, and the toasts step out of the way of the selection bar instead
  of appearing underneath it.
- **The library can be sorted without disturbing the load order.** View it by
  name, size, install date or author while the order the game obeys stays put.
  Dragging switches off while a different sort is showing, and says why —
  rearranging a list that is not in load order would move things somewhere you
  cannot see.
- **Update every mod in one go** instead of one click each, from a bar that
  appears when updates are found.
- **Syncing the catalogue no longer re-reads all of it.** The listing is
  ordered newest-first, so a routine sync now stops as soon as it reaches
  entries it already has — usually one or two pages instead of eleven. A
  **Deep** sync beside the button still walks everything, for when you want the
  whole catalogue rebuilt.
- **A download that fails is retried on its own**, twice, with a pause between
  attempts, so a moment of bad connectivity no longer leaves a red row waiting
  for you to notice it. The rest of the queue carries on meanwhile. Note that a
  retry restarts the file: downloads go through a real browser session to get
  past Cloudflare, and that route offers no way to resume a partial transfer.

### Fixed

- **The app no longer lets you break your own install while the game runs.**
  Every mod operation renames files the game keeps open, so a toggle attempted
  mid-session used to fail halfway, leaving the library and the game folder
  disagreeing. Installing, enabling, reordering and uninstalling are now paused
  with an explanation while F1 Manager 24 is open.
- **Mods that are no longer on disk are marked as such.** The library recorded
  what was installed and never looked again, so a `~mods` folder emptied by a
  game update left every mod still listed as present and active. Missing and
  incomplete mods are now flagged on every load, and a **Verify** button
  re-reads the files to catch ones that have been modified since.
- **There is something to send when it goes wrong.** The app writes a log, and
  Settings has a button that copies a summary of your setup for a bug report.
  Neither ever contains your Overtake session.

## [1.0.1] — 2026-08-16

### Added

- **A command palette.** `Ctrl+K` searches your installed mods and the
  Overtake.gg catalogue at once, and runs any action in the app — enable,
  disable, uninstall, sync, launch the game — without hunting for the tab it
  lives on. `?` lists every shortcut.
- **Right-click any mod** for its actions, in the library and in the grid.
- **The library in a grid.** Mods are pictures of cars, and the list showed
  them at 64 pixels. Switch between list and grid, and between comfortable and
  compact rows; the choice is remembered. Compact fits roughly twice as many
  mods on screen.
- **The catalogue as covers.** Browse is now a grid of posters, with the
  description, the mod page and the install button appearing on the card you
  are pointing at. Download progress and "already installed" are drawn on the
  card itself. A **New to me** filter hides everything already in your library.
- **Select several mods at a time** — tick, `Shift`-click for a range, `Ctrl+A`
  for all of them — then enable, disable, uninstall or move them to the top of
  the load order in one go.
- **Filters for the library**: active, disabled, conflicting, updatable, and
  mods installed from a local file, each with a count.
- **A summary above the library**: how many mods are active, what they take up
  on disk, how many conflicts are unresolved and how many updates are waiting.
  Each figure is also the way to act on it.
- **Undo after uninstalling.** Removing a mod no longer asks for a second
  click; it happens, and the message offers to put it back. The files are moved
  aside rather than deleted, and only discarded when the app next starts.
- **Download progress in the header**, so a mod in flight can be watched
  without opening the Pit Wall.
- **A collapsible sidebar** (`Ctrl+B`), which gives the catalogue grid back the
  width on a small window.
- **A section index in Settings**, which had grown into a long scroll with no
  map.
- **More shortcuts**: `Ctrl+J` downloads, `Ctrl+B` sidebar, `Ctrl+R` sync,
  `Ctrl+,` settings, `Esc` to clear a selection.

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

- **One visual system instead of twenty-five.** Type sizes, spacing, elevation,
  motion and the whole icon set are now defined once and used everywhere. The
  same icon used to be drawn at five different weights depending on which file
  it was pasted into; the smallest text in the app went up from 10px to 11px,
  and the muted grey was lightened so it clears the contrast threshold on the
  surfaces it actually sits on.
- **Reachable by keyboard.** Dialogs announce themselves as dialogs, keep Tab
  inside, and give focus back to whatever opened them when they close. The
  focus ring is now visible on everything you can reach, not only on buttons.
- **Paths, checksums and error messages can be copied again.** Text selection
  was switched off across the whole interface, which also made every failure
  message unquotable.
- **Dragging a mod shows where it will land**, instead of leaving you to infer
  it from the rows sliding apart.
- **Rows arrive in sequence** rather than all at once, counters count rather
  than jump, and switching tabs fades. All of it is skipped for anyone who has
  asked their system for less motion.
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

- **Mod pictures were blurry.** Overtake.gg's listing only publishes a 96×96
  icon per mod — there is no larger version on the server — and the cards were
  stretching it to roughly three times that, cropping the top and bottom off a
  square to fit a widescreen frame. The mod's picture is now drawn at its own
  size, sharp, over a heavily blurred copy of itself: nobody sees missing
  resolution in something deliberately out of focus, and the card picks up the
  mod's colours. The details panel was the worst case at a sevenfold
  enlargement, and gets the same treatment.
- **A handful of mods were shown at 48 pixels.** Those without an icon fall back
  to the author's avatar, which the listing links at its smallest size. Avatars
  do come in several sizes, so the app now asks for the 192-pixel one — four
  times the detail. Catalogues already on disk are corrected as they are read,
  without needing another sync.
- **Mods with no picture at all** now get a card generated from their name —
  initials over a colour derived from the title, the same one every time — so
  they can be told apart instead of being eleven identical grey rectangles.
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
