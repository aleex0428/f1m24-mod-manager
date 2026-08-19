import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  DndContext,
  DragOverlay,
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
import { EmptyState, NoResultsArt } from "../components/EmptyState";
import { LibrarySummary } from "../components/LibrarySummary";
import { BulkActionBar } from "../components/BulkActionBar";
import { NoticeCentre, type Notice } from "../components/NoticeCentre";
import { ProfileBar } from "../components/ProfileBar";
import { Icon } from "../components/Icon";
import { useContextMenu, type MenuAction } from "../components/ContextMenu";
import { useModStore } from "../store/modStore";
import { useMods } from "../hooks/useMods";
import { usePreference } from "../hooks/usePreference";
import { useListTransition } from "../hooks/useListTransition";
import { installLocalFile } from "../lib/install";
import { uninstallMod, uninstallMods } from "../lib/modActions";
import type { ConflictStanding, Mod, UpdateAvailable } from "../types";

/** Which slice of the library is on screen. */
export type LibraryFilter =
  | "all"
  | "active"
  | "disabled"
  | "conflict"
  | "update"
  | "local"
  | "broken"
  | "favourite";

/**
 * How the list is *shown*. Deliberately separate from load order, which is what
 * the game obeys: wanting to find the biggest mod on disk should not mean
 * rearranging what overrides what.
 */
export type LibrarySort = "order" | "name" | "size" | "installed" | "author";

const SORT_LABELS: Record<LibrarySort, string> = {
  order: "Load order",
  name: "Name",
  size: "Size on disk",
  installed: "Recently installed",
  author: "Author",
};

/**
 * Tags shown inline before the rest fold away. Enough for a normal library,
 * few enough that the filter row cannot wrap into a second line and undo the
 * point of merging the two rows in the first place.
 */
const TAGS_BEFORE_FOLD = 5;

const FILTER_LABELS: Record<LibraryFilter, string> = {
  all: "All",
  active: "Active",
  disabled: "Disabled",
  conflict: "Conflicting",
  update: "Updatable",
  local: "Local files",
  broken: "Needs attention",
  favourite: "Favourites",
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
  /** Tag currently narrowing the list, independent of the status filter. */
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showAllTags, setShowAllTags] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Every write into ~mods is refused while the game holds the .pak files
  // open, so the controls that write are disabled rather than left to fail.
  const gameRunning = useModStore((s) => s.gameRunning);
  const gamePatched = useModStore((s) => s.gamePatched);
  const setGamePatched = useModStore((s) => s.setGamePatched);
  const lockedHint = gameRunning ? "Close F1 Manager 24 first — its mod files are locked" : undefined;

  const [sort, setSort] = usePreference<LibrarySort>("library-sort", "order");

  const [viewMode, setViewMode] = usePreference<"list" | "grid">("library-view", "list");
  const [density, setDensity] = usePreference<"comfortable" | "compact">(
    "library-density",
    "comfortable"
  );

  const orderSignature = useRef("");
  const listRef = useRef<HTMLDivElement>(null);
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

    // Row numbers come from the applied order, which is what `loadOrder`
    // already encodes — the same list the badges are read against.
    const position = new Map(
      [...mods].sort((a, b) => a.loadOrder - b.loadOrder).map((m, index) => [m.id, index + 1])
    );

    for (const conflict of conflicts) {
      const contenders = conflict.mods.filter((id) => enabled.has(id));
      if (contenders.length < 2) continue;

      const winner = contenders.reduce((best, id) =>
        (order.get(id) ?? 0) < (order.get(best) ?? 0) ? id : best
      );

      for (const id of contenders) {
        const entry = map.get(id) ?? { chunks: [] };
        // -1 means the clash is file-level and belongs to no chunk.
        if (conflict.pakchunk >= 0) entry.chunks.push(conflict.pakchunk);
        if (conflict.files.length > 0) {
          entry.files = [...new Set([...(entry.files ?? []), ...conflict.files])];
        }
        // One measured clash makes the whole standing measured: an estimate
        // alongside a fact should not downgrade the fact.
        entry.certain = entry.certain || conflict.certain;
        if (id !== winner) {
          entry.overriddenBy = names.get(winner);
          entry.overriddenByPosition = position.get(winner);
        }
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
      if (tagFilter && !(mod.tags ?? []).includes(tagFilter)) return false;
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
        case "broken":
          return mod.integrity !== "ok";
        case "favourite":
          return mod.favourite;
        default:
          return true;
      }
    });
  }, [localOrder, modsById, normalizedQuery, filter, tagFilter, standingByMod, updatesByMod]);

  /**
   * The visible list. `order` returns it untouched — `localOrder` already *is*
   * the load order, so sorting by it would be a no-op that only risks
   * disagreeing with the drag state.
   */
  const visibleMods = useMemo(() => {
    if (sort === "order") return orderedMods;

    const sorted = [...orderedMods];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "size":
        sorted.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
        break;
      case "installed":
        // Newest first. Missing dates sink rather than sorting as epoch zero.
        sorted.sort((a, b) => (b.installedAt || "").localeCompare(a.installedAt || ""));
        break;
      case "author":
        sorted.sort((a, b) =>
          (a.author || "￿").localeCompare(b.author || "￿")
        );
        break;
    }
    return sorted;
  }, [orderedMods, sort]);

  /** Every tag in use, for the filter row. */
  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const mod of mods) for (const tag of mod.tags ?? []) seen.add(tag);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [mods]);

  const enabledCount = useMemo(() => mods.filter((m) => m.enabled).length, [mods]);
  const diskBytes = useMemo(() => mods.reduce((sum, m) => sum + (m.sizeBytes || 0), 0), [mods]);
  const isNarrowed = normalizedQuery.length > 0 || filter !== "all" || tagFilter !== null;
  /**
   * Reordering only makes sense against the whole list, shown in the order it
   * actually applies. Dragging row 3 above row 1 while sorted by name would
   * move it somewhere the user cannot see.
   */
  const canReorder = !isNarrowed && !isGrid && sort === "order";

  const filterCounts = useMemo(
    () => ({
      all: mods.length,
      active: enabledCount,
      disabled: mods.length - enabledCount,
      conflict: standingByMod.size,
      update: updates.length,
      local: mods.filter((m) => !m.sourceUrl).length,
      broken: mods.filter((m) => m.integrity !== "ok").length,
      favourite: mods.filter((m) => m.favourite).length,
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

  /**
   * Re-hash everything and mark what no longer matches.
   *
   * Reads every .pak from end to end, so it is never run automatically — the
   * presence check that runs on every load is the cheap half, and this is the
   * half the user asks for.
   */
  const handleVerify = useCallback(async () => {
    const toastId = toast.loading("Verifying installed files…");
    try {
      const changed = await invoke<string[]>("verify_mods");
      const store = useModStore.getState();
      for (const id of changed) store.updateMod(id, { integrity: "modified" });

      if (changed.length === 0) {
        toast.success("Every mod matches what was installed", { id: toastId });
      } else {
        toast.error(
          `${changed.length} mod${changed.length === 1 ? "" : "s"} no longer match what was installed`,
          { id: toastId }
        );
        setFilter("broken");
      }
    } catch (err) {
      toast.error(String(err), { id: toastId });
    }
  }, []);

  /**
   * Queue every pending update at once.
   *
   * The queue is serial and each job is deduplicated by mod id, so this is
   * simply the per-mod action repeated — no new download machinery, and the
   * Pit Wall shows them arriving one by one exactly as before.
   */
  const handleUpdateAll = useCallback(() => {
    if (updates.length === 0) return;
    for (const update of updates) applyUpdate(update);
    setUpdates([]);
    toast.success(`${updates.length} update${updates.length === 1 ? "" : "s"} queued`);
  }, [updates, applyUpdate]);

  // Commands from the palette land here, so there is one implementation of
  // each action rather than one per entry point.
  useEffect(() => {
    const focus = () => filterRef.current?.select();
    const install = () => handleInstallFile();
    const check = () => handleCheckUpdates();
    const verify = () => handleVerify();
    const updateAll = () => handleUpdateAll();

    window.addEventListener("app:focus-search", focus);
    window.addEventListener("app:install-file", install);
    window.addEventListener("app:check-updates", check);
    window.addEventListener("app:verify-files", verify);
    window.addEventListener("app:update-all", updateAll);
    return () => {
      window.removeEventListener("app:focus-search", focus);
      window.removeEventListener("app:install-file", install);
      window.removeEventListener("app:check-updates", check);
      window.removeEventListener("app:verify-files", verify);
      window.removeEventListener("app:update-all", updateAll);
    };
  }, [handleInstallFile, handleCheckUpdates, handleVerify, handleUpdateAll]);

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
          const ids = visibleMods.map((m) => m.id);
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
    [visibleMods]
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
      if (e.key.toLowerCase() === "a" && e.ctrlKey && !typing && visibleMods.length > 0) {
        e.preventDefault();
        setSelection(new Set(visibleMods.map((m) => m.id)));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection.size, clearSelection, visibleMods]);

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

  /** The row currently in the user's hand, for the floating ghost. */
  const draggingMod = draggingId ? modsById.get(draggingId) : undefined;

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

  // Rows slide to their new places when the list is filtered or re-sorted.
  // Off during a drag, when dnd-kit is already transforming the same elements.
  useListTransition(listRef, visibleMods.map((m) => m.id).join("|"), draggingId === null);

  const listBody = visibleMods.map((mod, index) => {
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

  /**
   * The informational notices, in severity order so the collapsed summary
   * reports the worst one.
   */
  const notices = useMemo<Notice[]>(() => {
    const list: Notice[] = [];

    // First: a patched game invalidates everything below it, so it explains
    // the other notices rather than competing with them.
    if (gamePatched) {
      list.push({
        id: "patched",
        tone: "warning",
        icon: "warning-solid",
        message:
          "F1 Manager 24 has been updated since you last opened this. Mods built for the previous version often stop working, and can stop the game launching at all.",
        actions: [
          {
            label: "Disable all mods",
            disabled: gameRunning,
            title: lockedHint,
            onClick: () => {
              handleSetAll(false).then(() => setGamePatched(false));
            },
          },
          { label: "Dismiss", onClick: () => setGamePatched(false) },
        ],
      });
    }

    if (filterCounts.broken > 0 && filter !== "broken") {
      list.push({
        id: "broken",
        tone: "danger",
        icon: "warning-solid",
        message: `${filterCounts.broken} mod${filterCounts.broken === 1 ? "" : "s"} ${
          filterCounts.broken === 1 ? "is" : "are"
        } missing files in the game folder — a game update or a manual clean-up removes them.`,
        actions: [{ label: "Show them", onClick: () => setFilter("broken") }],
      });
    }

    if (updates.length > 0) {
      list.push({
        id: "updates",
        tone: "accent",
        icon: "upload",
        message: `${updates.length} mod${updates.length === 1 ? " has" : "s have"} a newer version on Overtake.gg.`,
        actions: [
          { label: "Show them", onClick: () => setFilter("update") },
          {
            label: "Update all",
            onClick: handleUpdateAll,
            disabled: gameRunning,
            title: lockedHint,
          },
        ],
      });
    }

    if (sort !== "order" && !isGrid && mods.length > 1) {
      list.push({
        id: "sort",
        tone: "info",
        icon: "warning",
        message: `Sorted by ${SORT_LABELS[sort].toLowerCase()} — dragging is off until you switch back to load order.`,
        actions: [{ label: "Load order", onClick: () => setSort("order") }],
      });
    }

    return list;
  }, [
    filterCounts.broken,
    filter,
    updates.length,
    handleUpdateAll,
    gameRunning,
    lockedHint,
    sort,
    isGrid,
    mods.length,
    setSort,
    gamePatched,
    setGamePatched,
    handleSetAll,
  ]);

  return (
    <div className="flex h-full flex-col" data-density={density}>
      {/* Header */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
        <div>
          <h1 className="section-title">My Mods</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {mods.length === 0
              ? "Nothing installed yet"
              : `${visibleMods.length}${isNarrowed ? ` of ${mods.length}` : ""} shown`}
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
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as LibrarySort)}
                aria-label="Sort the list"
                title="Changes how the list is shown, not the order the game loads mods in"
                className="input !w-auto !py-2 !pr-8 !text-xs"
              >
                {(Object.keys(SORT_LABELS) as LibrarySort[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>

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

          <button
            onClick={handleVerify}
            className="btn-ghost !py-2"
            title="Re-read every installed file and check it still matches"
          >
            <Icon name="check-circle" size={16} />
            Verify
          </button>

          <button onClick={handleOpenFolder} className="btn-ghost !py-2" title="Open the ~mods folder">
            <Icon name="folder" size={16} />
            Folder
          </button>

          <button
            onClick={handleInstallFile}
            disabled={installing || gameRunning}
            title={lockedHint}
            className="btn-primary !py-2"
          >
            <Icon name="plus" size={16} strokeWidth={2} />
            Install file
          </button>
        </div>
      </div>

      {mods.length > 0 && <ProfileBar onApplied={loadMods} />}

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

          {allTags.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-border" />
              {(showAllTags ? allTags : allTags.slice(0, TAGS_BEFORE_FOLD)).map((tag) => (
                <button
                  key={tag}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                  aria-pressed={tagFilter === tag}
                  className={`filter-chip ${tagFilter === tag ? "filter-chip-active" : ""}`}
                >
                  {tag}
                </button>
              ))}
              {allTags.length > TAGS_BEFORE_FOLD && (
                <button
                  onClick={() => setShowAllTags((v) => !v)}
                  className="btn-subtle !py-1 !text-xs"
                >
                  {showAllTags ? "Fewer tags" : `+${allTags.length - TAGS_BEFORE_FOLD} tags`}
                </button>
              )}
            </>
          )}

          <span className="ml-auto flex items-center gap-1">
            <button
              onClick={() => handleSetAll(true)}
              disabled={gameRunning}
              className="btn-subtle !py-1.5 !text-xs"
              title={lockedHint ?? "Enable every installed mod"}
            >
              Enable all
            </button>
            <button
              onClick={() => handleSetAll(false)}
              disabled={gameRunning}
              className="btn-subtle !py-1.5 !text-xs"
              title={lockedHint ?? "Disable every installed mod — handy before a game update"}
            >
              Disable all
            </button>
          </span>
        </div>
      )}

      {/* Everything the app wants to say, in one strip.
          Notices that explain a *disabled control* are not here — those live at
          the app level with their own row, because a greyed-out button whose
          reason is folded behind a chevron is just a broken button. */}
      <NoticeCentre notices={notices} />

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
            <button
              onClick={handleApplyOrder}
              disabled={gameRunning}
              title={lockedHint}
              className="btn-primary !py-1.5 !text-xs"
            >
              Apply order
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-4">
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
        ) : visibleMods.length === 0 ? (
          <EmptyState
            art={<NoResultsArt />}
            title={normalizedQuery ? "Nothing matches that" : "Nothing in that group"}
            description={
              normalizedQuery
                ? `None of your ${mods.length} installed mods has “${query}” in its name or author.`
                : `None of your ${mods.length} installed mods is ${FILTER_LABELS[
                    filter
                  ].toLowerCase()}${tagFilter ? ` and tagged “${tagFilter}”` : ""}.`
            }
            action={
              <button
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                  setTagFilter(null);
                }}
                className="btn-ghost"
              >
                Clear the filters
              </button>
            }
          />
        ) : isGrid ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 pb-6">
            {visibleMods.map((mod, index) => (
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
              items={visibleMods.map((m) => m.id)}
              strategy={verticalListSortingStrategy}
              disabled={!canReorder}
            >
              <div className="flex flex-col gap-[var(--row-gap)] pb-4">{listBody}</div>
            </SortableContext>

            {/* What you are holding. Without it dnd-kit slides the original row
                around and there is nothing under the cursor, which reads as the
                list rearranging itself rather than as you moving something. */}
            <DragOverlay dropAnimation={null}>
              {draggingMod && (
                <div className="drag-ghost flex items-center gap-3 rounded-2xl border border-f1red/60 bg-surface-raised px-4 py-3 shadow-f1-strong">
                  <Icon name="grip" size={16} className="text-f1red" />
                  <span className="font-mono text-sm font-bold text-f1red">
                    {(localOrder.indexOf(draggingMod.id) + 1).toString().padStart(2, "0")}
                  </span>
                  <span className="max-w-[22rem] truncate text-sm font-semibold text-text-primary">
                    {draggingMod.name}
                  </span>
                </div>
              )}
            </DragOverlay>
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
