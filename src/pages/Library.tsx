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
import type { UpdateAvailable } from "../types";

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
    const toastId = toast.loading("Installing mod…");
    try {
      await invoke("install_mod", { zipPath: path });
      await loadMods();
      toast.success("Mod installed", { id: toastId });
    } catch (err) {
      toast.error(`Install failed: ${err}`, { id: toastId });
    } finally {
      setInstalling(false);
    }
  }, [loadMods]);

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

  const conflictChunksByMod = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const conflict of conflicts) {
      for (const id of conflict.mods) {
        const list = map.get(id);
        if (list) list.push(conflict.pakchunk);
        else map.set(id, [conflict.pakchunk]);
      }
    }
    return map;
  }, [conflicts]);

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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="input !w-44 !py-2 !pl-9 !text-sm"
              />
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
                {orderedMods.map((mod) => (
                  <ModCard
                    key={mod.id}
                    mod={mod}
                    position={localOrder.indexOf(mod.id) + 1}
                    conflictChunks={conflictChunksByMod.get(mod.id) ?? []}
                    update={updatesByMod.get(mod.id)}
                    onToggle={toggleMod}
                    onDelete={deleteMod}
                    onUpdate={handleUpdate}
                    onOpenFolder={handleOpenFolder}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
