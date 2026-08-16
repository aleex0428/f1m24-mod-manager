import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import toast from "react-hot-toast";

import { Icon, type IconName } from "./Icon";
import { useModStore } from "../store/modStore";
import { enqueueDownload } from "../lib/queue";
import { linkOvertakeAccount } from "../lib/auth";
import { setModEnabled, uninstallMod } from "../lib/modActions";
import type { CatalogMod } from "../types";

/** Commands the shell owns rather than the palette. */
interface PaletteHooks {
  onOpenDownloads: () => void;
  onToggleSidebar: () => void;
  reloadMods: () => Promise<void> | void;
}

interface Command {
  id: string;
  group: string;
  label: string;
  /** Secondary line, e.g. the author of a mod. */
  detail?: string;
  icon: IconName;
  /** Extra words that should match, without being shown. */
  keywords?: string;
  hint?: string;
  perform: () => void;
}

const CATALOG_SEARCH_LIMIT = 5;
const CATALOG_DEBOUNCE_MS = 220;
const MAX_PER_GROUP = 6;

/**
 * Everything the app can do, one keystroke away.
 *
 * A mod manager is a search problem wearing a list: the thing you want is a
 * name you already know, and the interface makes you remember which tab it
 * lives on first. This collapses that — mods, catalogue entries, navigation
 * and app actions all answer the same box.
 *
 * Actions that belong to a page (syncing, installing a file, checking mod
 * updates) are dispatched as window events and handled there, rather than
 * duplicated here, so there is still exactly one implementation of each.
 */
export function CommandPalette({
  isOpen,
  onClose,
  hooks,
}: {
  isOpen: boolean;
  onClose: () => void;
  hooks: PaletteHooks;
}) {
  const navigate = useNavigate();
  const mods = useModStore((s) => s.mods);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [catalogHits, setCatalogHits] = useState<CatalogMod[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Reset between openings: a palette that remembers last time's query is a
  // palette you have to clear before you can use it.
  useEffect(() => {
    if (!isOpen) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActiveIndex(0);
    setCatalogHits([]);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(timer);
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [isOpen]);

  // The catalogue is a backend query, so it is debounced and only runs once
  // the query is worth a round trip.
  useEffect(() => {
    if (!isOpen || query.trim().length < 2) {
      setCatalogHits([]);
      return;
    }
    const timer = setTimeout(() => {
      invoke<CatalogMod[]>("search_mods", {
        query: query.trim(),
        limit: CATALOG_SEARCH_LIMIT,
        offset: 0,
        sort: "downloads",
      })
        .then(setCatalogHits)
        .catch(() => setCatalogHits([]));
    }, CATALOG_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, isOpen]);

  const run = useCallback(
    (command: Command) => {
      onClose();
      command.perform();
    },
    [onClose]
  );

  const dispatch = useCallback((event: string) => {
    // Let the destination page mount before it is asked to do something.
    setTimeout(() => window.dispatchEvent(new CustomEvent(event)), 60);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: "go-library",
        group: "Go to",
        label: "My Mods",
        icon: "library",
        hint: "Ctrl+1",
        perform: () => navigate("/library"),
      },
      {
        id: "go-browse",
        group: "Go to",
        label: "Browse the catalogue",
        icon: "browse",
        hint: "Ctrl+2",
        perform: () => navigate("/browse"),
      },
      {
        id: "go-settings",
        group: "Go to",
        label: "Settings",
        icon: "settings",
        hint: "Ctrl+,",
        perform: () => navigate("/settings"),
      },
      {
        id: "go-downloads",
        group: "Go to",
        label: "Downloads",
        icon: "download",
        hint: "Ctrl+J",
        keywords: "pit wall queue",
        perform: hooks.onOpenDownloads,
      },
      {
        id: "act-play",
        group: "Actions",
        label: "Launch F1 Manager 24",
        icon: "play",
        keywords: "play start game",
        perform: () => {
          invoke("launch_game")
            .then(() => toast.success("Launching F1 Manager 24…"))
            .catch((err) => toast.error(`Could not launch the game: ${err}`));
        },
      },
      {
        id: "act-sync",
        group: "Actions",
        label: "Sync the mod catalogue",
        icon: "refresh",
        hint: "Ctrl+R",
        keywords: "refresh overtake update list",
        perform: () => {
          navigate("/browse");
          dispatch("app:sync-catalog");
        },
      },
      {
        id: "act-check-updates",
        group: "Actions",
        label: "Check installed mods for updates",
        icon: "upload",
        keywords: "new version",
        perform: () => {
          navigate("/library");
          dispatch("app:check-updates");
        },
      },
      {
        id: "act-install-file",
        group: "Actions",
        label: "Install a mod from a file",
        icon: "plus",
        keywords: "zip rar 7z pak local archive",
        perform: () => {
          navigate("/library");
          dispatch("app:install-file");
        },
      },
      {
        id: "act-folder",
        group: "Actions",
        label: "Open the ~mods folder",
        icon: "folder",
        keywords: "explorer directory",
        perform: () => {
          invoke("open_mods_folder").catch((err) => toast.error(String(err)));
        },
      },
      {
        id: "act-enable-all",
        group: "Actions",
        label: "Enable every mod",
        icon: "power",
        perform: () => {
          invoke<number>("set_all_mods_enabled", { enabled: true })
            .then(async (changed) => {
              await hooks.reloadMods();
              toast.success(changed === 0 ? "Nothing to change" : `${changed} mods enabled`);
            })
            .catch((err) => toast.error(String(err)));
        },
      },
      {
        id: "act-disable-all",
        group: "Actions",
        label: "Disable every mod",
        icon: "power",
        keywords: "turn off before game update",
        perform: () => {
          invoke<number>("set_all_mods_enabled", { enabled: false })
            .then(async (changed) => {
              await hooks.reloadMods();
              toast.success(changed === 0 ? "Nothing to change" : `${changed} mods disabled`);
            })
            .catch((err) => toast.error(String(err)));
        },
      },
      {
        id: "act-sidebar",
        group: "Actions",
        label: "Collapse or expand the sidebar",
        icon: "panel-left",
        hint: "Ctrl+B",
        perform: hooks.onToggleSidebar,
      },
      {
        id: "act-link",
        group: "Actions",
        label: "Link the Overtake.gg account",
        icon: "link",
        keywords: "sign in login session",
        perform: () => linkOvertakeAccount(),
      },
    ];

    for (const mod of mods) {
      list.push({
        id: `mod-toggle-${mod.id}`,
        group: "Installed mods",
        label: `${mod.enabled ? "Disable" : "Enable"} ${mod.name}`,
        detail: mod.author ? `by ${mod.author}` : undefined,
        icon: mod.enabled ? "close" : "check",
        keywords: `${mod.name} ${mod.author ?? ""} toggle`,
        perform: () => setModEnabled(mod.id, !mod.enabled),
      });
      list.push({
        id: `mod-remove-${mod.id}`,
        group: "Installed mods",
        label: `Uninstall ${mod.name}`,
        icon: "trash",
        keywords: `${mod.name} delete remove`,
        perform: () => uninstallMod(mod.id, mod.name, hooks.reloadMods),
      });
      if (mod.sourceUrl) {
        list.push({
          id: `mod-open-${mod.id}`,
          group: "Installed mods",
          label: `Open the page for ${mod.name}`,
          icon: "external",
          keywords: `${mod.name} overtake website`,
          perform: () => {
            shellOpen(mod.sourceUrl!).catch(() => {});
          },
        });
      }
    }

    for (const hit of catalogHits) {
      list.push({
        id: `cat-${hit.overtakeId}`,
        group: "Catalogue",
        label: `Install ${hit.title}`,
        detail: hit.author ? `by ${hit.author}` : undefined,
        icon: "download",
        keywords: hit.title,
        perform: () => {
          if (enqueueDownload({ jobId: hit.overtakeId, title: hit.title, pageUrl: hit.url })) {
            toast.success(`${hit.title} added to the queue`);
            hooks.onOpenDownloads();
          }
        },
      });
    }

    return list;
  }, [mods, catalogHits, navigate, hooks, dispatch]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const scored = commands
      .map((command) => ({
        command,
        score: score(`${command.label} ${command.keywords ?? ""}`.toLowerCase(), needle),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    // Cap each group so a library of 60 mods cannot bury the actions.
    const perGroup = new Map<string, number>();
    const kept: Command[] = [];
    for (const { command } of scored) {
      const seen = perGroup.get(command.group) ?? 0;
      if (seen >= MAX_PER_GROUP) continue;
      perGroup.set(command.group, seen + 1);
      kept.push(command);
    }
    return kept;
  }, [commands, query]);

  useEffect(() => setActiveIndex(0), [query]);

  // Keep the highlighted row in view when walking the list with the keyboard.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen) return null;

  const grouped: { group: string; items: { command: Command; index: number }[] }[] = [];
  results.forEach((command, index) => {
    const last = grouped[grouped.length - 1];
    if (last && last.group === command.group) last.items.push({ command, index });
    else grouped.push({ group: command.group, items: [{ command, index }] });
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const command = results[activeIndex];
      if (command) run(command);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-palette flex animate-fade-in items-start justify-center bg-black/70 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="panel w-full max-w-xl animate-slide-up overflow-hidden bg-surface shadow-elev-3"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Icon name="search" size={17} className="text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search mods, or type a command…"
            aria-label="Search mods, or type a command"
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            className="flex-1 bg-transparent py-4 text-md text-text-primary outline-none placeholder:text-text-muted"
          />
          <span className="kbd">Esc</span>
        </div>

        <div
          id="palette-results"
          ref={listRef}
          role="listbox"
          className="max-h-[22rem] overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-text-muted">
              Nothing matches “{query}”.
            </p>
          ) : (
            grouped.map((section) => (
              <div key={section.group} className="mb-1 last:mb-0">
                <p className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
                  {section.group}
                </p>
                {section.items.map(({ command, index }) => (
                  <button
                    key={command.id}
                    data-index={index}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => run(command)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-fast ${
                      index === activeIndex
                        ? "bg-f1red/[0.12] text-text-primary"
                        : "text-text-secondary hover:bg-surface-raised"
                    }`}
                  >
                    <Icon
                      name={command.icon}
                      size={16}
                      className={index === activeIndex ? "text-f1red" : "text-text-muted"}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{command.label}</span>
                    {command.detail && (
                      <span className="flex-shrink-0 truncate text-xs text-text-muted">
                        {command.detail}
                      </span>
                    )}
                    {command.hint && <span className="kbd">{command.hint}</span>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>

        <footer className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-2xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> to move
          </span>
          <span className="flex items-center gap-1.5">
            <span className="kbd">↵</span> to run
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="kbd">?</span> all shortcuts
          </span>
        </footer>
      </div>
    </div>
  );
}

/**
 * Rank a candidate against the query.
 *
 * Exact substring beats a scattered subsequence, and a match at the start of
 * the label beats one in the middle, so typing "fer" puts "Ferrari 2025" above
 * "Disable Alfa Ferrari-engined". An empty query keeps everything, in the
 * order the commands were declared.
 */
function score(haystack: string, needle: string): number {
  if (!needle) return 1;

  const at = haystack.indexOf(needle);
  if (at === 0) return 1000;
  if (at > 0) return 700 - Math.min(at, 200);

  // Subsequence: every character in order, anywhere.
  let cursor = 0;
  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor);
    if (cursor === -1) return 0;
    cursor += 1;
  }
  return 200;
}
