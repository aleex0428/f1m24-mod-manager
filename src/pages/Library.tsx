import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import toast from "react-hot-toast";

import { ModCard } from "../components/ModCard";
import { CompatibilityView } from "../components/CompatibilityView";
import { GetStarted } from "../components/GetStarted";
import { Skeleton } from "../components/Skeleton";
import { useMods } from "../hooks/useMods";
import { installLocalFile } from "../lib/install";
import type { ConflictStanding, UpdateAvailable } from "../types";

export function Library() {
  const {
    mods,
    conflicts,
    isLoading,
    loadMods,
    toggleMod,
    deleteMod,
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
  const [showConflicts, setShowConflicts] = useState(false);
  const orderSignature = useRef("");
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focus = () => filterRef.current?.select();
    window.addEventListener("app:focus-search", focus);
    return () => window.removeEventListener("app:focus-search", focus);
  }, []);

  // Re-sync the local drag order only when the set of mods really changed,
  // so an unrelated store update cannot silently discard a pending reorder.
  useEffect(() => {
    const ids = mods.map((m) => m.id);
    const signature = [...ids].sort().join("|");
    if (signature === orderSignature.current) return;
    orderSignature.current = signature;
    setLocalOrder(ids);
    setHasUnappliedChanges(false);
  }, [mods]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
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
      toast.success(`${found.length} update${found.length > 1 ? "s" : ""} available`, { id: toastId });
    } else {
      toast.success("Everything is up to date", { id: toastId });
    }
    setCheckingUpdates(false);
  }, [checkForUpdates]);

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

  const updatesByMod = useMemo(
    () => new Map(updates.map((u) => [u.modId, u])),
    [updates]
  );

  const normalizedQuery = query.trim().toLowerCase();

  const orderedMods = useMemo(() => {
    const list = localOrder
      .map((id) => modsById.get(id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
    if (!normalizedQuery) return list;
    return list.filter(
      (m) =>
        m.name.toLowerCase().includes(normalizedQuery) ||
        m.author?.toLowerCase().includes(normalizedQuery)
    );
  }, [localOrder, modsById, normalizedQuery]);

  const enabledCount = useMemo(() => mods.filter((m) => m.enabled).length, [mods]);
  const isFiltered = normalizedQuery.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-4">
        <div>
          <h1 className="section-title">My Mods</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {mods.length} installed · {enabledCount} active
            {conflicts.length > 0 && (
              <button
                onClick={() => setShowConflicts((v) => !v)}
                className="ml-2 text-warning underline-offset-2 hover:underline"
              >
                · {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""}
              </button>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mods.length > 0 && (
            <div className="relative">
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
                ref={filterRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="input !w-44 !py-2 !pl-9 !text-sm"
              />
            </div>
          )}

          {mods.length > 1 && (
            <div className="flex overflow-hidden rounded-xl border border-border">
              <button
                onClick={() => handleSetAll(true)}
                className="px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
                title="Enable every installed mod"
              >
                Enable all
              </button>
              <span className="w-px bg-border" />
              <button
                onClick={() => handleSetAll(false)}
                className="px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
                title="Disable every installed mod — handy before a game update"
              >
                Disable all
              </button>
            </div>
          )}

          <button onClick={handleCheckUpdates} disabled={checkingUpdates} className="btn-ghost !py-2">
            <svg
              className={`h-4 w-4 ${checkingUpdates ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Updates
          </button>

          <button onClick={handleOpenFolder} className="btn-ghost !py-2" title="Open the ~mods folder">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            Folder
          </button>

          <button onClick={handleInstallFile} disabled={installing} className="btn-primary !py-2">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Install file
          </button>
        </div>
      </div>

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
          <p className="py-16 text-center text-sm text-text-muted">
            No mods match “{query}”.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={orderedMods.map((m) => m.id)}
              strategy={verticalListSortingStrategy}
              disabled={isFiltered}
            >
              <div className="space-y-2.5 pb-4">
                {orderedMods.map((mod) => {
                  const position = localOrder.indexOf(mod.id);
                  return (
                    <ModCard
                      key={mod.id}
                      mod={mod}
                      position={position + 1}
                      isFirst={position === 0}
                      isLast={position === localOrder.length - 1}
                      standing={standingByMod.get(mod.id)}
                      update={updatesByMod.get(mod.id)}
                      onToggle={toggleMod}
                      onDelete={deleteMod}
                      onUpdate={handleUpdate}
                      onOpenFolder={handleOpenFolder}
                      onMove={isFiltered ? undefined : handleMove}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
