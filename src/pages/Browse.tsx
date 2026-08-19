import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import toast from "react-hot-toast";

import { InstallFromUrlModal } from "../components/InstallFromUrlModal";
import { Skeleton } from "../components/Skeleton";
import { Icon } from "../components/Icon";
import { ModCover } from "../components/ModCover";
import { EmptyState, EmptyCatalogueArt, NoResultsArt } from "../components/EmptyState";
import { useModStore } from "../store/modStore";
import { enqueueDownload } from "../lib/queue";
import { linkOvertakeAccount } from "../lib/auth";
import { formatCount, formatDate } from "../lib/format";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type { CatalogMod, CatalogStats, DownloadStatus } from "../types";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 280;
/// After this long the catalogue is stale enough that update checks start
/// lying by omission, so the user is nudged to sync.
const STALE_CATALOG_DAYS = 14;

type SortKey = "recent" | "downloads" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Recently updated",
  downloads: "Most downloaded",
  name: "Name (A-Z)",
};

interface SyncProgress {
  current_page: number;
  total_pages: number;
  mods_found: number;
}

export function Browse() {
  const [mods, setMods] = useState<CatalogMod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [sort, setSort] = useState<SortKey>("recent");
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [hideInstalled, setHideInstalled] = useState(false);
  const pageRef = useRef(0);

  const isLoggedIn = useModStore((s) => s.isLoggedIn);
  const gamePathValid = useModStore((s) => s.gamePathValid);
  const installedMods = useModStore((s) => s.mods);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl+F, dispatched globally by the app shell.
  useEffect(() => {
    const focus = () => searchRef.current?.select();
    window.addEventListener("app:focus-search", focus);
    return () => window.removeEventListener("app:focus-search", focus);
  }, []);

  const installedUrls = useMemo(() => {
    const set = new Set<string>();
    for (const mod of installedMods) {
      if (mod.sourceUrl) set.add(normalizeUrl(mod.sourceUrl));
    }
    return set;
  }, [installedMods]);

  // ─── Data loading ─────────────────────────────────────────
  // `sortKey` is a parameter rather than a dependency so the callback stays
  // stable and can never fetch with a stale ordering.
  const fetchPage = useCallback(
    async (search: string, pageNum: number, append: boolean, sortKey: SortKey) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsLoading(true);
      try {
        const data = await invoke<CatalogMod[]>("search_mods", {
          query: search,
          limit: PAGE_SIZE,
          offset: pageNum * PAGE_SIZE,
          sort: sortKey,
        });

        setHasMore(data.length >= PAGE_SIZE);
        setMods((prev) => {
          if (!append) return data;
          // The observer can fire twice around a re-render; never duplicate rows.
          const seen = new Set(prev.map((m) => m.overtakeId));
          return [...prev, ...data.filter((m) => !seen.has(m.overtakeId))];
        });
      } catch (err) {
        toast.error(`Could not read the local catalog: ${err}`);
      } finally {
        setIsLoading(false);
        inFlightRef.current = false;
      }
    },
    []
  );

  const refreshStats = useCallback(() => {
    invoke<CatalogStats>("get_catalog_stats").then(setStats).catch(() => {});
  }, []);

  // Debounced search — no submit needed.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    pageRef.current = 0;
    setHasMore(true);
    fetchPage(query, 0, false, sort);
  }, [query, sort, fetchPage]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Infinite scroll.
  useEffect(() => {
    const target = sentinelRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || !hasMore || inFlightRef.current) return;
        pageRef.current += 1;
        fetchPage(query, pageRef.current, true, sort);
      },
      { threshold: 0.1, rootMargin: "200px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, query, sort, fetchPage, mods.length]);

  // ─── Catalog sync ─────────────────────────────────────────
  /**
   * `deep` walks every page; a routine sync stops as soon as it reaches
   * entries it already has. The listing is ordered newest-first, so that is
   * sound — but it is the one shortcut that could lose data quietly if the
   * site ever changed, which is why the full walk stays one click away.
   */
  const handleSync = useCallback(async (deep = false) => {
    if (inFlightRef.current) return;
    setIsSyncing(true);
    setSyncProgress({ current_page: 0, total_pages: 1, mods_found: 0 });

    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<SyncProgress>("sync-progress", (e) => setSyncProgress(e.payload));
      const count = await invoke<number>("sync_overtake_database", { deep });
      toast.success(
        deep ? `Full sync complete — ${count} mods` : `Catalog synced — ${count} new or updated`
      );
      pageRef.current = 0;
      setHasMore(true);
      await fetchPage(query, 0, false, sort);
      refreshStats();
    } catch (err) {
      toast.error(String(err));
    } finally {
      unlisten?.();
      setIsSyncing(false);
      setSyncProgress(null);
    }
  }, [fetchPage, query, sort, refreshStats]);

  // Ctrl+R and the command palette both arrive here.
  useEffect(() => {
    const onSync = () => {
      if (!isSyncing) handleSync(false);
    };
    window.addEventListener("app:sync-catalog", onSync);
    return () => window.removeEventListener("app:sync-catalog", onSync);
  }, [handleSync, isSyncing]);

  const handleInstall = useCallback(
    (mod: CatalogMod) => {
      if (!gamePathValid) {
        toast.error("Set a valid game folder in Settings before downloading");
        return;
      }
      if (!isLoggedIn) {
        toast.error("Link your Overtake.gg account to download mods");
        linkOvertakeAccount();
        return;
      }
      if (enqueueDownload({ jobId: mod.overtakeId, title: mod.title, pageUrl: mod.url })) {
        toast.success(`${mod.title} added to the queue`);
      }
    },
    [gamePathValid, isLoggedIn]
  );

  const catalogAgeDays = useMemo(() => {
    if (!stats?.lastSync) return null;
    const synced = new Date(stats.lastSync).getTime();
    if (Number.isNaN(synced)) return null;
    return Math.floor((Date.now() - synced) / 86_400_000);
  }, [stats]);

  const isCatalogStale =
    catalogAgeDays !== null && catalogAgeDays >= STALE_CATALOG_DAYS && (stats?.count ?? 0) > 0;

  const handleInstallFromUrl = useCallback(
    (pageUrl: string) => {
      if (!gamePathValid) {
        toast.error("Set a valid game folder in Settings before downloading");
        return;
      }
      if (!isLoggedIn) {
        toast.error("Link your Overtake.gg account to download mods");
        linkOvertakeAccount();
        return;
      }

      // Reuse the Overtake resource id as the job id when the link carries one,
      // so pasting a link the catalogue already lists does not queue it twice.
      const id = pageUrl.match(/\.(\d+)\/?$/)?.[1];
      const slug = pageUrl.replace(/\/+$/, "").split("/").pop() ?? "";
      const title = slug.replace(/\.\d+$/, "").replace(/[-_]+/g, " ").trim() || "Mod from Overtake.gg";

      if (enqueueDownload({ jobId: id ?? `link-${pageUrl}`, title, pageUrl })) {
        toast.success(`${title} added to the queue`);
      }
    },
    [gamePathValid, isLoggedIn]
  );

  const syncPercent = syncProgress
    ? Math.max(4, Math.round((syncProgress.current_page / Math.max(1, syncProgress.total_pages)) * 100))
    : 0;

  const visibleMods = useMemo(
    () => (hideInstalled ? mods.filter((m) => !installedUrls.has(normalizeUrl(m.url))) : mods),
    [mods, hideInstalled, installedUrls]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-border/70 px-6 py-4">
        <div className="relative min-w-[16rem] flex-1 max-w-md">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            ref={searchRef}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search the Overtake.gg catalog…"
            aria-label="Search the catalogue"
            className="input !py-2 !pl-9"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
              title="Clear"
              aria-label="Clear the search"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setHideInstalled((v) => !v)}
            aria-pressed={hideInstalled}
            className={`filter-chip !py-1.5 ${hideInstalled ? "filter-chip-active" : ""}`}
            title="Hide the mods already in your library"
          >
            <Icon name="filter" size={13} />
            New to me
          </button>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="input !w-auto !py-2 !pr-8 !text-xs"
            aria-label="Sort the catalogue"
            title="Sort the catalogue"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>

          <button
            onClick={() => setUrlDialogOpen(true)}
            className="btn-ghost !py-2"
            title="Install a mod from its Overtake.gg link"
          >
            <Icon name="link" size={16} />
            From URL
          </button>

          <div className="flex overflow-hidden rounded-xl border border-border">
            <button
              onClick={() => handleSync(false)}
              disabled={isSyncing}
              className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary disabled:opacity-50"
              title="Fetch what is new since the last sync (Ctrl+R)"
            >
              <Icon name="refresh" size={16} className={isSyncing ? "animate-spin" : ""} />
              {isSyncing ? "Syncing…" : "Sync catalog"}
            </button>
            <span className="w-px bg-border" />
            <button
              onClick={() => handleSync(true)}
              disabled={isSyncing}
              className="px-2.5 py-2 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:opacity-50"
              title="Walk every page and rebuild the whole catalogue"
            >
              Deep
            </button>
          </div>
        </div>

        <div className="flex w-full items-center gap-3 text-xs text-text-muted">
          <span
            className={`chip ${
              isLoggedIn
                ? "border-success/25 bg-success/10 text-success"
                : "border-border bg-surface text-text-muted"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isLoggedIn ? "bg-success" : "bg-text-muted"}`} />
            {isLoggedIn ? "Linked" : "Not linked"}
          </span>
          {stats && (
            <span>
              {stats.count} mods cached
              {stats.lastSync && ` · synced ${formatDate(stats.lastSync)}`}
            </span>
          )}
          {hideInstalled && (
            <span className="text-text-secondary">
              {mods.length - visibleMods.length} already installed hidden
            </span>
          )}
        </div>
      </div>

      {/* Stale catalogue: update checks quietly stop being reliable. */}
      {isCatalogStale && !isSyncing && (
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-warning/20 bg-warning/10 px-6 py-2.5">
          <Icon name="warning-solid" size={16} className="text-warning" />
          <span className="flex-1 text-xs text-warning">
            The catalogue was last synced {catalogAgeDays} days ago — new mods and updates are missing.
          </span>
          <button onClick={() => handleSync(false)} className="btn-ghost !py-1.5 !text-xs border-warning/30 text-warning">
            Sync now
          </button>
        </div>
      )}

      {/* Sync progress */}
      {isSyncing && syncProgress && (
        <div className="flex-shrink-0 border-b border-border/70 bg-surface/40 px-6 py-3">
          <div className="mb-1.5 flex justify-between text-xs text-text-secondary">
            <span>
              Reading page {syncProgress.current_page} of {syncProgress.total_pages}
            </span>
            <span className="font-mono">{syncProgress.mods_found} mods</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${syncPercent}%` }} />
          </div>
        </div>
      )}

      <InstallFromUrlModal
        isOpen={urlDialogOpen}
        onClose={() => setUrlDialogOpen(false)}
        onSubmit={handleInstallFromUrl}
      />

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && mods.length === 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="h-[15rem] w-full" />
            ))}
          </div>
        ) : visibleMods.length === 0 ? (
          <EmptyCatalog
            isSearching={query.length > 0}
            isFiltered={hideInstalled && mods.length > 0}
            onSync={() => handleSync(false)}
            onShowAll={() => setHideInstalled(false)}
            isSyncing={isSyncing}
          />
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
              {visibleMods.map((mod, index) => (
                <CatalogTile
                  key={mod.overtakeId}
                  mod={mod}
                  index={index}
                  installed={installedUrls.has(normalizeUrl(mod.url))}
                  onInstall={handleInstall}
                />
              ))}
            </div>

            <div ref={sentinelRef} className="flex justify-center py-6">
              {isLoading && mods.length > 0 && (
                <span className="flex items-center gap-2 text-sm text-text-muted">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-f1red border-t-transparent" />
                  Loading more…
                </span>
              )}
              {!hasMore && <span className="text-xs text-text-muted">End of the list</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tile ──────────────────────────────────────────────────

interface CatalogTileProps {
  mod: CatalogMod;
  index: number;
  installed: boolean;
  onInstall: (mod: CatalogMod) => void;
}

const BUSY_LABEL: Partial<Record<DownloadStatus, string>> = {
  queued: "Queued",
  initiating: "Starting…",
  connecting: "Connecting…",
  downloading: "Downloading…",
  verifying: "Verifying…",
  installing: "Installing…",
  login_required: "Sign in",
  completed: "Installed",
};

/** Statuses where the tile should show a live bar over the cover. */
const IN_FLIGHT: DownloadStatus[] = ["initiating", "connecting", "downloading", "verifying", "installing"];

/**
 * A catalogue entry as a poster.
 *
 * The listing is browsed to find something worth installing, and what people
 * actually recognise is the picture — a livery, a helmet, a HUD. The old row
 * showed it at 56px next to three lines of metadata, which is the layout for
 * scanning a table, not for choosing. The metadata is still all here; it just
 * stops competing with the thing you came to look at.
 */
const CatalogTile = memo(function CatalogTile({ mod, index, installed, onInstall }: CatalogTileProps) {
  // Subscribing to this tile's own status keeps progress ticks from
  // re-rendering the entire catalog.
  const status = useModStore((s) => s.jobs[mod.overtakeId]?.status);
  const busyLabel = status ? BUSY_LABEL[status] : undefined;
  const failed = status === "error";
  const inFlight = status ? IN_FLIGHT.includes(status) : false;

  return (
    <article
      style={{ "--i": index } as React.CSSProperties}
      className="stagger cv-auto-tile group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface/60 shadow-elev-1 transition-colors duration-base hover:border-border-strong"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-bg-elevated">
        {/* No `scale` on hover: the source is a 96px icon, and magnifying it
            further was half of why these looked so rough. The blurred backdrop
            inside ModCover is what reacts instead. */}
        <ModCover
          src={mod.imageUrl ?? undefined}
          name={mod.title}
          reactive
          className="absolute inset-0 h-full w-full"
        />


        {installed && !busyLabel && (
          <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-lg bg-success/90 px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-black">
            <Icon name="check" size={12} strokeWidth={2.5} />
            Installed
          </span>
        )}

        {mod.version && (
          <span className="absolute right-2.5 top-2.5 rounded-lg bg-black/70 px-2 py-1 font-mono text-2xs text-white/90">
            v{mod.version}
          </span>
        )}

        {/* Secondary by design: opening the page is the one action that can
            wait for you to point at the card. The description and Install do
            not, which is why they are always on. */}
        <button
          onClick={() => shellOpen(mod.url).catch(() => {})}
          className="absolute right-2.5 bottom-2.5 rounded-lg bg-black/70 p-1.5 text-white opacity-0 transition-opacity duration-base hover:bg-black/90 group-hover:opacity-100 focus-visible:opacity-100"
          title="Open the mod page on Overtake.gg"
          aria-label={`Open the Overtake.gg page for ${mod.title}`}
        >
          <Icon name="external" size={15} />
        </button>

        {/* The webview never reports a total size, so this is an honest sweep
            pinned to the bottom of the cover. */}
        {inFlight && (
          <span className="progress-track progress-track-thin absolute inset-x-0 bottom-0 rounded-none">
            <span className="progress-indeterminate block" />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <h3 className="truncate text-sm font-semibold text-text-primary" title={mod.title}>
          {mod.title}
        </h3>

        <p className="truncate text-2xs text-text-muted">
          {mod.author ? `by ${mod.author}` : "Unknown author"}
          {mod.lastUpdated && ` · ${mod.lastUpdated}`}
        </p>

        {/* Always visible. Browsing is how you decide what to install, and
            requiring a hover per card to read what something *is* turns
            discovery into fifty deliberate gestures. */}
        {mod.description && (
          <p className="clamp-2 text-2xs leading-snug text-text-muted/80" title={mod.description}>
            {mod.description}
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-2">
          <span className="flex items-center gap-1 font-mono text-2xs text-text-muted">
            <Icon name="download" size={12} />
            {formatCount(mod.downloadCount)}
          </span>

          <button
            onClick={() => onInstall(mod)}
            disabled={Boolean(busyLabel)}
            className={`ml-auto !py-1.5 !text-xs ${
              failed
                ? "btn-danger animate-shake"
                : installed && !busyLabel
                  ? "btn-ghost border-success/30 text-success"
                  : busyLabel
                    ? "btn-ghost"
                    : "btn-primary"
            } min-w-[6.5rem]`}
          >
            {failed ? "Retry" : busyLabel ?? (installed ? "Reinstall" : "Install")}
          </button>
        </div>
      </div>
    </article>
  );
});

// ─── Empty state ───────────────────────────────────────────

function EmptyCatalog({
  isSearching,
  isFiltered,
  onSync,
  onShowAll,
  isSyncing,
}: {
  isSearching: boolean;
  isFiltered: boolean;
  onSync: () => void;
  onShowAll: () => void;
  isSyncing: boolean;
}) {
  if (isFiltered) {
    return (
      <EmptyState
        art={<NoResultsArt />}
        title="You already have all of these"
        description="Every mod matching your search is in your library. Turn the filter off to see them alongside the rest."
        action={
          <button onClick={onShowAll} className="btn-ghost">
            Show installed mods too
          </button>
        }
      />
    );
  }

  if (isSearching) {
    return (
      <EmptyState
        art={<NoResultsArt />}
        title="Nothing matches that"
        description="No mod in your local copy of the catalogue has that in its name, author or description. If it is new, a sync may not have picked it up yet."
        action={
          <button onClick={onSync} disabled={isSyncing} className="btn-ghost">
            <Icon name="refresh" size={16} className={isSyncing ? "animate-spin" : ""} />
            Sync the catalogue
          </button>
        }
      />
    );
  }

  return (
    <EmptyState
      art={<EmptyCatalogueArt />}
      title="Nothing here yet"
      description="Sync once to pull the F1 Manager 2024 downloads section from Overtake.gg. It is kept on your machine, so browsing and searching work offline afterwards."
      action={
        <button onClick={onSync} disabled={isSyncing} className="btn-primary">
          <Icon name="refresh" size={16} className={isSyncing ? "animate-spin" : ""} />
          Sync catalog
        </button>
      }
    />
  );
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/download$/, "").toLowerCase();
}
