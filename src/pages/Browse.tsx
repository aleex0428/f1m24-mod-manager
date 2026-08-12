import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import toast from "react-hot-toast";

import { Skeleton } from "../components/Skeleton";
import { useModStore } from "../store/modStore";
import { enqueueDownload } from "../lib/queue";
import { linkOvertakeAccount } from "../lib/auth";
import { formatCount, formatDate } from "../lib/format";
import type { CatalogMod, CatalogStats, DownloadStatus } from "../types";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 280;

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
  const pageRef = useRef(0);

  const isLoggedIn = useModStore((s) => s.isLoggedIn);
  const gamePathValid = useModStore((s) => s.gamePathValid);
  const installedMods = useModStore((s) => s.mods);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);

  const installedUrls = useMemo(() => {
    const set = new Set<string>();
    for (const mod of installedMods) {
      if (mod.sourceUrl) set.add(normalizeUrl(mod.sourceUrl));
    }
    return set;
  }, [installedMods]);

  // ─── Data loading ─────────────────────────────────────────
  const fetchPage = useCallback(async (search: string, pageNum: number, append: boolean) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsLoading(true);
    try {
      const data = await invoke<CatalogMod[]>("search_mods", {
        query: search,
        limit: PAGE_SIZE,
        offset: pageNum * PAGE_SIZE,
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
  }, []);

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
    fetchPage(query, 0, false);
  }, [query, fetchPage]);

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
        fetchPage(query, pageRef.current, true);
      },
      { threshold: 0.1, rootMargin: "200px" }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, query, fetchPage, mods.length]);

  // ─── Catalog sync ─────────────────────────────────────────
  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncProgress({ current_page: 0, total_pages: 1, mods_found: 0 });

    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<SyncProgress>("sync-progress", (e) => setSyncProgress(e.payload));
      const count = await invoke<number>("sync_overtake_database");
      toast.success(`Catalog synced — ${count} mods`);
      pageRef.current = 0;
      setHasMore(true);
      await fetchPage(query, 0, false);
      refreshStats();
    } catch (err) {
      toast.error(String(err));
    } finally {
      unlisten?.();
      setIsSyncing(false);
      setSyncProgress(null);
    }
  }, [fetchPage, query, refreshStats]);

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

  const syncPercent = syncProgress
    ? Math.max(4, Math.round((syncProgress.current_page / Math.max(1, syncProgress.total_pages)) * 100))
    : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-border/70 px-6 py-4">
        <div className="relative min-w-[16rem] flex-1 max-w-md">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search the Overtake.gg catalog…"
            className="input !py-2 !pl-9"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
              title="Clear"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {stats && (
            <span className="hidden text-xs text-text-muted sm:block">
              {stats.count} mods cached
              {stats.lastSync && ` · synced ${formatDate(stats.lastSync)}`}
            </span>
          )}

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

          <button onClick={handleSync} disabled={isSyncing} className="btn-ghost !py-2">
            <svg
              className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {isSyncing ? "Syncing…" : "Sync catalog"}
          </button>
        </div>
      </div>

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

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && mods.length === 0 ? (
          <div className="space-y-2.5">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-[76px] w-full" />
            ))}
          </div>
        ) : mods.length === 0 ? (
          <EmptyCatalog isSearching={query.length > 0} onSync={handleSync} isSyncing={isSyncing} />
        ) : (
          <>
            <div className="space-y-2">
              {mods.map((mod) => (
                <CatalogRow
                  key={mod.overtakeId}
                  mod={mod}
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

// ─── Row ───────────────────────────────────────────────────

interface CatalogRowProps {
  mod: CatalogMod;
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

const CatalogRow = memo(function CatalogRow({ mod, installed, onInstall }: CatalogRowProps) {
  // Subscribing to this row's own status keeps progress ticks from
  // re-rendering the entire catalog list.
  const status = useModStore((s) => s.jobs[mod.overtakeId]?.status);
  const busyLabel = status ? BUSY_LABEL[status] : undefined;
  const failed = status === "error";

  return (
    <article className="cv-auto panel panel-hover flex items-center gap-4 p-3">
      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-bg-elevated">
        {mod.imageUrl ? (
          <img
            src={mod.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-muted/40">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-text-primary" title={mod.title}>
            {mod.title}
          </h3>
          {mod.version && (
            <span className="chip flex-shrink-0 border-border bg-surface-raised text-text-secondary">
              v{mod.version}
            </span>
          )}
        </div>
        {mod.description && (
          <p className="mt-0.5 truncate text-xs text-text-muted" title={mod.description}>
            {mod.description}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-text-muted">
          {mod.author && <span className="truncate">by {mod.author}</span>}
          <span className="font-mono">{formatCount(mod.downloadCount)} downloads</span>
          {mod.lastUpdated && <span>updated {mod.lastUpdated}</span>}
        </div>
      </div>

      <button
        onClick={() => onInstall(mod)}
        disabled={Boolean(busyLabel)}
        className={`!py-2 !text-xs ${
          failed
            ? "btn-danger animate-shake"
            : installed && !busyLabel
              ? "btn-ghost border-success/30 text-success"
              : busyLabel
                ? "btn-ghost"
                : "btn-primary"
        } w-[7.5rem] flex-shrink-0`}
      >
        {failed ? "Retry" : busyLabel ?? (installed ? "Reinstall" : "Install")}
      </button>
    </article>
  );
});

// ─── Empty state ───────────────────────────────────────────

function EmptyCatalog({
  isSearching,
  onSync,
  isSyncing,
}: {
  isSearching: boolean;
  onSync: () => void;
  isSyncing: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-20 text-center text-text-muted">
      <svg className="mb-4 h-12 w-12 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1}
          d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
        />
      </svg>
      {isSearching ? (
        <p className="text-sm">No cached mod matches that search.</p>
      ) : (
        <>
          <p className="text-sm font-medium text-text-secondary">The local catalog is empty</p>
          <p className="mb-5 mt-1 text-xs">
            Sync once to pull the F1 Manager 2024 downloads section from Overtake.gg.
          </p>
          <button onClick={onSync} disabled={isSyncing} className="btn-primary">
            Sync catalog
          </button>
        </>
      )}
    </div>
  );
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/download$/, "").toLowerCase();
}
