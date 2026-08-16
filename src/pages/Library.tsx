import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import toast from "react-hot-toast";

import { ModCard } from "../components/ModCard";
import { ModTile } from "../components/ModTile";
import { CompatibilityView } from "../components/CompatibilityView";
import { GetStarted } from "../components/GetStarted";
import { Skeleton } from "../components/Skeleton";
import { LibrarySummary } from "../components/LibrarySummary";
import { BulkActionBar } from "../components/BulkActionBar";
import { Icon } from "../components/Icon";
import { useContextMenu, type MenuAction } from "../components/ContextMenu";
import { useMods } from "../hooks/useMods";
import { usePreference } from "../hooks/usePreference";
import { installLocalFile } from "../lib/install";
import { uninstallMod, uninstallMods } from "../lib/modActions";
import type { ConflictStanding, Mod, UpdateAvailable } from "../types";

/** Which slice of the library is on screen. */
export type LibraryFilter = "all" | "active" | "disabled" | "conflict" | "update" | "local";

const FILTER_LABELS: Record<LibraryFilter, string> = {
  all: "All",
  active: "Active",
  disabled: "Disabled",
  conflict: "Conflicting",
  update: "Updatable",
  local: "Local files",
};

export function Library() {
  const {
    mods,
    conflicts,
    isLoading,
    loadMods,
    toggleMod,
    applyLoadOrder,
    checkForUpdates,
    applyUpdate,
  } = useMods();

  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [hasUnappliedChanges, setHasUnappliedChanges] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updates, setUpdates] = useState<UpdateAvailable[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [showConflicts, setShowConflicts] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const [viewMode, setViewMode] = usePreference<"list" | "grid">("library-view", "list");
  const [density, setDensity] = usePreference<"comfortable" | "compact">(
    "library-density",
    "comfortable"
  );

  const orderSignature = useRef("");
  const filterRef = useRef<HTMLInputElement>(null);
  const lastClickedRef = useRef<string | null>(null);
  const menu = useContextMenu();

  const compact = density === "compact";
  const isGrid = viewMode === "grid";

  // ─── Derived data ─────────────────────────────────────────
  const modsById = useMemo(() => new Map(mods.map((m) => [m.id, m])), [mods]);

  // Who actually applies. The winner is whichever contender sits highest in
  // the *applied* order, so this reads loadOrder rather than the local drag
  // order: until Apply is pressed, the game still sees the old arrangement.
  const standingByMod = useMemo(() => {
    const map = new Map<string, ConflictStanding>();
    const order = new Map(mods.map((m) => [m.id, m.loadOrder]));
    const names = new Map(mods.map((m) => [m.id, m.name]));
    const enabled = new Set(mods.filter((m) => m.enabled).map((m) => m.id));

    for (const conflict of conflicts) {
      const contenders = conflict.mods.filter((id) => enabled.has(id));
      if (contenders.length < 2) continue;

      const winner = contenders.reduce((best, id) =>
        (order.get(id) ?? 0) < (order.get(best) ?? 0) ? id : best
      );

      for (const id of contenders) {
        const entry = map.get(id) ?? { chunks: [] };
        entry.chunks.push(conflict.pakchunk);
        if (id !== winner) entry.overriddenBy = names.get(winner);
        map.set(id, entry);
      }
    }
    return map;
  }, [conflicts, mods]);

  const updatesByMod = useMemo(() => new Map(updates.map((u) => [u.modId, u])), [updates]);

  const normalizedQuery = query.trim().toLowerCase();

  const orderedMods = useMemo(() => {
    const list = localOrder
      .map((id) => modsById.get(id))
      .filter((m): m is Mod => Boolean(m));

    return list.filter((mod) => {
      if (normalizedQuery) {
        const haystack = `${mod.name} ${mod.author ?? ""}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      switch (filter) {
        case "active":
          return mod.enabled;
        case "disabled":
          return !mod.enabled;
        case "conflict":
          return standingByMod.has(mod.id);
        case "update":
          return updatesByMod.has(mod.id);
        case "local":
          return !mod.sourceUrl;
        default:
          return true;
      }
    });
  }, [localOrder, modsById, normalizedQuery, filter, standingByMod, updatesByMod]);

  const enabledCount = useMemo(() => mods.filter((m) => m.enabled).length, [mods]);
  const diskBytes = useMemo(() => mods.reduce((sum, m) => sum + (m.sizeBytes || 0), 0), [mods]);
  const isNarrowed = normalizedQuery.length > 0 || filter !== "all";
  /** Reordering only makes sense against the whole, ordered list. */
  const canReorder = !isNarrowed && !isGrid;

  const filterCounts = useMemo(
    () => ({
      all: mods.length,
      active: enabledCount,
      disabled: mods.length - enabledCount,
      conflict: standingByMod.size,
      update: updates.length,
      local: mods.filter((m) => !m.sourceUrl).length,
    }),
    [mods, enabledCount, standingByMod, updates]
  );

  // ─── Order bookkeeping ────────────────────────────────────
  // Re-sync the local drag order only when the set of mods really changed,
  // so an unrelated store update cannot silently discard a pending reorder.
  useEffect(() => {
    const ids = mods.map((m) => m.id);
    const signature = [...ids].sort().join("|");
    if (signature === orderSignature.current) return;
    orderSignature.current = signature;
    setLocalOrder(ids);
    setHasUnappliedChanges(false);
    // A mod that is gone cannot stay selected.
    setSelection((prev) => {
      const next = new Set([...prev].filter((id) => ids.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [mods]);

  // ─── Actions ──────────────────────────────────────────────
  const handleInstallFile = useCallback(async () => {
    const file = await open({
      title: "Select a mod archive",
      filters: [{ name: "Mod files", extensions: ["zip", "rar", "7z", "pak"] }],
      multiple: false,
    }).catch(() => null);

    if (!file) return;
    const path = typeof file === "string" ? file : (file as { path: string }).path;

    setInstalling(true);
    // Same path as dropping a file on the window, including the variant
    // question. The library refreshes from the backend's mod-installed event.
    await installLocalFile(path);
    setInstalling(false);
  }, []);

  const handleCheckUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    const toastId = toast.loading("Checking for updates…");
    const found = await checkForUpdates();
    setUpdates(found);
    if (found.length > 0) {
      toast.success(`${found.length} update${found.length > 1 ? "s" : ""} available`, {
        id: toastId,
      });
    } else {
      toast.success("Everything is up to date", { id: toastId });
    }
    setCheckingUpdates(false);
  }, [checkForUpdates]);

  // Commands from the palette land here, so there is one implementation of
  // each action rather than one per entry point.
  useEffect(() => {
    const focus = () => filterRef.current?.select();
    const install = () => handleInstallFile();
    const check = () => handleCheckUpdates();

    window.addEventListener("app:focus-search", focus);
    window.addEventListener("app:install-file", install);
    window.addEventListener("app:check-updates", check);
    return () => {
      window.removeEventListener("app:focus-search", focus);
      window.removeEventListener("app:install-file", install);
      window.removeEventListener("app:check-updates", check);
    };
  }, [handleInstallFile, handleCheckUpdates]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId((event.over?.id as string) ?? null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggingId(null);
    setOverId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalOrder((prev) => {
      const oldIdx = prev.indexOf(active.id as string);
      const newIdx = prev.indexOf(over.id as string);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
    setHasUnappliedChanges(true);
  }, []);

  const handleMove = useCallback((id: string, direction: "up" | "down") => {
    setLocalOrder((prev) => {
      const from = prev.indexOf(id);
      const to = direction === "up" ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      return arrayMove(prev, from, to);
    });
    setHasUnappliedChanges(true);
  }, []);

  const handleSetAll = useCallback(
    async (enabled: boolean) => {
      const toastId = toast.loading(enabled ? "Enabling every mod…" : "Disabling every mod…");
      try {
        const changed = await invoke<number>("set_all_mods_enabled", { enabled });
        await loadMods();
        toast.success(
          changed === 0
            ? "Nothing to change"
            : `${changed} mod${changed === 1 ? "" : "s"} ${enabled ? "enabled" : "disabled"}`,
          { id: toastId }
        );
      } catch (err) {
        toast.error(String(err), { id: toastId });
      }
    },
    [loadMods]
  );

  const handleApplyOrder = useCallback(async () => {
    await applyLoadOrder(localOrder);
    setHasUnappliedChanges(false);
  }, [applyLoadOrder, localOrder]);

  const handleUpdate = useCallback(
    (update: UpdateAvailable) => {
      applyUpdate(update);
      setUpdates((prev) => prev.filter((u) => u.modId !== update.modId));
      toast.success(`${update.modName} queued for update`);
    },
    [applyUpdate]
  );

  const handleOpenFolder = useCallback(async () => {
    try {
      await invoke("open_mods_folder");
    } catch (err) {
      toast.error(String(err));
    }
  }, []);

  const handleDelete = useCallback(
    (modId: string) => {
      const mod = modsById.get(modId);
      if (mod) uninstallMod(mod.id, mod.name, loadMods);
    },
    [modsById, loadMods]
  );

  // ─── Selection ────────────────────────────────────────────
  const handleSelect = useCallback(
    (id: string, event: MouseEvent) => {
      setSelection((prev) => {
        const next = new Set(prev);

        // Shift extends from the last row clicked, over the list as it is
        // currently filtered — the range you can see is the range you get.
        if (event.shiftKey && lastClickedRef.current) {
          const ids = orderedMods.map((m) => m.id);
          const from = ids.indexOf(lastClickedRef.current);
          const to = ids.indexOf(id);
          if (from >= 0 && to >= 0) {
            const [start, end] = from < to ? [from, to] : [to, from];
            for (let i = start; i <= end; i += 1) next.add(ids[i]);
            return next;
          }
        }

        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastClickedRef.current = id;
    },
    [orderedMods]
  );

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const selectedMods = useMemo(
    () => [...selection].map((id) => modsById.get(id)).filter((m): m is Mod => Boolean(m)),
    [selection, modsById]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "Escape" && selection.size > 0 && !typing) {
        e.preventDefault();
        clearSelection();
        return;
      }
      if (e.key.toLowerCase() === "a" && e.ctrlKey && !typing && orderedMods.length > 0) {
        e.preventDefault();
        setSelection(new Set(orderedMods.map((m) => m.id)));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection.size, clearSelection, orderedMods]);

  const bulkSetEnabled = useCallback(
    async (enabled: boolean) => {
      const targets = selectedMods.filter((m) => m.enabled !== enabled);
      if (targets.length === 0) {
        toast("Nothing to change");
        return;
      }
      for (const mod of targets) {
        await invoke("toggle_mod", { modId: mod.id, enabled }).catch(() => {});
      }
      await loadMods();
      toast.success(`${targets.length} mod${targets.length === 1 ? "" : "s"} ${enabled ? "enabled" : "disabled"}`);
    },
    [selectedMods, loadMods]
  );

  const bulkUninstall = useCallback(async () => {
    const targets = selectedMods.map((m) => ({ id: m.id, name: m.name }));
    clearSelection();
    await uninstallMods(targets, loadMods);
  }, [selectedMods, clearSelection, loadMods]);

  const bulkToTop = useCallback(() => {
    setLocalOrder((prev) => {
      const chosen = prev.filter((id) => selection.has(id));
      const rest = prev.filter((id) => !selection.has(id));
      return [...chosen, ...rest];
    });
    setHasUnappliedChanges(true);
    toast.success("Moved to the top — press Apply order to write it to disk");
  }, [selection]);

  // ─── Context menu ─────────────────────────────────────────
  const openRowMenu = useCallback(
    (event: MouseEvent, mod: Mod) => {
      const update = updatesByMod.get(mod.id);
      const inSelection = selection.has(mod.id) && selection.size > 1;

      const items: MenuAction[] = inSelection
        ? [
            {
              label: `Enable ${selection.size} mods`,
              icon: "check",
              onSelect: () => bulkSetEnabled(true),
            },
            {
              label: `Disable ${selection.size} mods`,
              icon: "close",
              onSelect: () => bulkSetEnabled(false),
            },
            {
              label: `Uninstall ${selection.size} mods`,
              icon: "trash",
              danger: true,
              separatorBefore: true,
              onSelect: bulkUninstall,
            },
          ]
        : [
            {
              label: mod.enabled ? "Disable" : "Enable",
              icon: mod.enabled ? "close" : "check",
              onSelect: () => toggleMod(mod.id, !mod.enabled),
            },
            ...(update
              ? [
                  {
                    label: `Update to ${update.newVersion}`,
                    icon: "upload" as const,
                    onSelect: () => handleUpdate(update),
                  },
                ]
              : []),
            {
              label: "Move to the top",
              icon: "chevron-up",
              disabled: !canReorder,
              separatorBefore: true,
              onSelect: () => {
                setLocalOrder((prev) => [mod.id, ...prev.filter((id) => id !== mod.id)]);
                setHasUnappliedChanges(true);
              },
            },
            {
              label: "Open the ~mods folder",
              icon: "folder",
              onSelect: handleOpenFolder,
            },
            ...(mod.sourceUrl
              ? [
                  {
                    label: "Open the mod page",
                    icon: "external" as const,
                    onSelect: () => {
                      shellOpen(mod.sourceUrl!).catch(() => {});
                    },
                  },
                ]
              : []),
            {
              label: "Uninstall",
              icon: "trash",
              danger: true,
              separatorBefore: true,
              onSelect: () => handleDelete(mod.id),
            },
          ];

      menu.open(event, items);
    },
    [
      menu,
      selection,
      updatesByMod,
      canReorder,
      toggleMod,
      handleUpdate,
      handleOpenFolder,
      handleDelete,
      bulkSetEnabled,
      bulkUninstall,
    ]
  );

  /** Which edge of the hovered row the dragged one would settle on. */
  const dropEdgeFor = useCallback(
    (id: string): "above" | "below" | undefined => {
      if (!draggingId || !overId || overId !== id || draggingId === id) return undefined;
      const from = localOrder.indexOf(draggingId);
      const to = localOrder.indexOf(id);
      return from > to ? "above" : "below";
    },
    [draggingId, overId, localOrder]
  );

  const listBody = orderedMods.map((mod, index) => {
    const position = localOrder.indexOf(mod.id);
    return (
      <ModCard
        key={mod.id}
        mod={mod}
        index={index}
        compact={compact}
        position={position + 1}
        isFirst={position === 0}
        isLast={position === localOrder.length - 1}
        standing={standingByMod.get(mod.id)}
        update={updatesByMod.get(mod.id)}
        selected={selection.has(mod.id)}
        selectionActive={selection.size > 0}
        dropEdge={dropEdgeFor(mod.id)}
        onSelect={handleSelect}
        onToggle={toggleMod}
        onDelete={handleDelete}
        onUpdate={handleUpdate}
        onOpenFolder={handleOpenFolder}
        onMove={canReorder ? handleMove : undefined}
        onContextMenu={openRowMenu}
      />
    );
  });

  return (
    <div className="flex h-full flex-col" data-density={density}>
      {/* Header */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
        <div>
          <h1 className="section-title">My Mods</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {mods.length === 0
              ? "Nothing installed yet"
              : `${orderedMods.length}${isNarrowed ? ` of ${mods.length}` : ""} shown`}
            {conflicts.length > 0 && (
              <button
                onClick={() => setShowConflicts((v) => !v)}
                className="ml-2 text-warning underline-offset-2 hover:underline"
              >
                · {showConflicts ? "Hide" : "Show"} the compatibility matrix
              </button>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mods.length > 0 && (
            <div className="relative">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                ref={filterRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                aria-label="Filter installed mods"
                className="input !w-44 !py-2 !pl-9 !text-sm"
              />
            </div>
          )}

          {mods.length > 1 && (
            <>
              {/* View mode */}
              <div className="flex overflow-hidden rounded-xl border border-border" role="group" aria-label="View mode">
                <ViewButton
                  active={!isGrid}
                  onClick={() => setViewMode("list")}
                  icon="list"
                  label="List view"
                />
                <span className="w-px bg-border" />
                <ViewButton
                  active={isGrid}
                  onClick={() => setViewMode("grid")}
                  icon="grid"
                  label="Grid view"
                />
              </div>

              {/* Density — meaningless in grid, where the tile size is the
                  density. */}
              {!isGrid && (
                <div className="flex overflow-hidden rounded-xl border border-border" role="group" aria-label="Row density">
                  <ViewButton
                    active={!compact}
                    onClick={() => setDensity("comfortable")}
                    icon="rows"
                    label="Comfortable rows"
                  />
                  <span className="w-px bg-border" />
                  <ViewButton
                    active={compact}
                    onClick={() => setDensity("compact")}
                    icon="list"
                    label="Compact rows"
                  />
                </div>
              )}
            </>
          )}

          <button onClick={handleOpenFolder} className="btn-ghost !py-2" title="Open the ~mods folder">
            <Icon name="folder" size={16} />
            Folder
          </button>

          <button onClick={handleInstallFile} disabled={installing} className="btn-primary !py-2">
            <Icon name="plus" size={16} strokeWidth={2} />
            Install file
          </button>
        </div>
      </div>

      {mods.length > 0 && (
        <LibrarySummary
          total={mods.length}
          active={enabledCount}
          diskBytes={diskBytes}
          conflicts={conflicts.length}
          updates={updates.length}
          checkingUpdates={checkingUpdates}
          filter={filter}
          onFilter={setFilter}
          onCheckUpdates={handleCheckUpdates}
        />
      )}

      {/* Filters */}
      {mods.length > 1 && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-border/70 px-6 py-2.5">
          {(Object.keys(FILTER_LABELS) as LibraryFilter[]).map((key) => {
            const count = filterCounts[key];
            if (count === 0 && key !== "all" && filter !== key) return null;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`filter-chip ${filter === key ? "filter-chip-active" : ""}`}
              >
                {FILTER_LABELS[key]}
                <span className="font-mono text-2xs opacity-70">{count}</span>
              </button>
            );
          })}

          <span className="ml-auto flex items-center gap-1">
            <button
              onClick={() => handleSetAll(true)}
              className="btn-subtle !py-1.5 !text-xs"
              title="Enable every installed mod"
            >
              Enable all
            </button>
            <button
              onClick={() => handleSetAll(false)}
              className="btn-subtle !py-1.5 !text-xs"
              title="Disable every installed mod — handy before a game update"
            >
              Disable all
            </button>
          </span>
        </div>
      )}

      {/* Pending reorder bar */}
      {hasUnappliedChanges && (
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-f1red/20 bg-f1red/10 px-6 py-2.5">
          <p className="text-xs text-text-secondary">
            Load order changed — the mod at the top overrides the ones below it.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setLocalOrder(mods.map((m) => m.id));
                setHasUnappliedChanges(false);
              }}
              className="btn-subtle !py-1.5 !text-xs"
            >
              Discard
            </button>
            <button onClick={handleApplyOrder} className="btn-primary !py-1.5 !text-xs">
              Apply order
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {showConflicts && conflicts.length > 0 && (
          <div className="mb-4">
            <CompatibilityView />
          </div>
        )}

        {isLoading && mods.length === 0 ? (
          <div className="space-y-2.5">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[88px] w-full" />
            ))}
          </div>
        ) : mods.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-8 py-12">
            <GetStarted />
            <button onClick={handleInstallFile} className="btn-subtle !text-xs">
              or install a .zip / .pak you already have
            </button>
          </div>
        ) : orderedMods.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-text-muted">
              {normalizedQuery
                ? `No mod matches “${query}”.`
                : `No mod is ${FILTER_LABELS[filter].toLowerCase()}.`}
            </p>
            <button
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              className="btn-subtle mt-2 !text-xs"
            >
              Clear the filters
            </button>
          </div>
        ) : isGrid ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 pb-6">
            {orderedMods.map((mod, index) => (
              <ModTile
                key={mod.id}
                mod={mod}
                index={index}
                position={localOrder.indexOf(mod.id) + 1}
                standing={standingByMod.get(mod.id)}
                update={updatesByMod.get(mod.id)}
                selected={selection.has(mod.id)}
                selectionActive={selection.size > 0}
                onSelect={handleSelect}
                onToggle={toggleMod}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                onContextMenu={openRowMenu}
              />
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              setDraggingId(null);
              setOverId(null);
            }}
          >
            <SortableContext
              items={orderedMods.map((m) => m.id)}
              strategy={verticalListSortingStrategy}
              disabled={!canReorder}
            >
              <div className="flex flex-col gap-[var(--row-gap)] pb-4">{listBody}</div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <BulkActionBar
        count={selection.size}
        onEnable={() => bulkSetEnabled(true)}
        onDisable={() => bulkSetEnabled(false)}
        onUninstall={bulkUninstall}
        onTop={bulkToTop}
        onClear={clearSelection}
      />

      {menu.element}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: "list" | "grid" | "rows";
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-[38px] w-10 items-center justify-center transition-colors duration-fast ${
        active
          ? "bg-f1red/[0.12] text-f1red"
          : "text-text-muted hover:bg-surface-raised hover:text-text-primary"
      }`}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
