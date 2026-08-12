import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";
import { enqueueDownload } from "../lib/queue";
import type { ConflictInfo, Mod, UpdateAvailable } from "../types";

// ─── Raw shape returned by Rust (serde camelCase) ──────────
interface RawMod {
  id: string;
  name: string;
  author: string | null;
  version: string | null;
  description: string | null;
  imageUrl: string | null;
  tags: string[];
  parentModId: string | null;
  installedFilenames: string[];
  pakchunks: number[];
  checksum: string;
  enabled: boolean;
  loadOrder: number;
  installedAt: string;
  sourceUrl: string | null;
}

function parseMod(raw: RawMod): Mod {
  return {
    id: raw.id,
    name: raw.name,
    author: raw.author ?? undefined,
    version: raw.version ?? undefined,
    description: raw.description ?? undefined,
    thumbnailUrl: raw.imageUrl ?? undefined,
    imageUrl: raw.imageUrl ?? undefined,
    tags: raw.tags ?? [],
    parentModId: raw.parentModId ?? undefined,
    pakFiles: raw.installedFilenames ?? [],
    pakchunks: raw.pakchunks ?? [],
    checksum: raw.checksum,
    enabled: raw.enabled,
    loadOrder: raw.loadOrder,
    installedAt: raw.installedAt,
    sourceUrl: raw.sourceUrl ?? undefined,
  };
}

/**
 * Mod library actions. Every value is read through a selector so a component
 * only re-renders for the slice it actually uses.
 */
export function useMods() {
  const mods = useModStore((s) => s.mods);
  const conflicts = useModStore((s) => s.conflicts);
  const isLoading = useModStore((s) => s.isLoading);
  const error = useModStore((s) => s.error);

  const refreshConflicts = useCallback(async () => {
    try {
      const raw = await invoke<ConflictInfo[]>("detect_conflicts");
      useModStore.getState().setConflicts(raw);
    } catch {
      // Non-critical: conflicts are advisory.
    }
  }, []);

  const loadMods = useCallback(async () => {
    const store = useModStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
      const rawMods = await invoke<RawMod[]>("get_mods");
      useModStore.getState().setMods(rawMods.map(parseMod));
      await refreshConflicts();
    } catch (err) {
      useModStore.getState().setError(String(err));
      toast.error(`Failed to load mods: ${err}`);
    } finally {
      useModStore.getState().setLoading(false);
    }
  }, [refreshConflicts]);

  const toggleMod = useCallback(
    async (modId: string, enabled: boolean) => {
      const store = useModStore.getState();
      // Optimistic: the switch flips instantly, and rolls back on failure.
      store.updateMod(modId, { enabled });
      try {
        await invoke("toggle_mod", { modId, enabled });
        await refreshConflicts();
      } catch (err) {
        useModStore.getState().updateMod(modId, { enabled: !enabled });
        toast.error(`Failed to toggle mod: ${err}`);
      }
    },
    [refreshConflicts]
  );

  const deleteMod = useCallback(
    async (modId: string) => {
      try {
        await invoke("delete_mod", { modId });
        await loadMods();
        toast.success("Mod removed");
      } catch (err) {
        toast.error(`Failed to remove mod: ${err}`);
      }
    },
    [loadMods]
  );

  const applyLoadOrder = useCallback(
    async (orderedIds: string[]) => {
      const toastId = toast.loading("Applying load order…");
      try {
        await invoke("apply_load_order", { orderedModIds: orderedIds });
        await loadMods();
        toast.success("Load order applied", { id: toastId });
      } catch (err) {
        toast.error(`Failed to apply load order: ${err}`, { id: toastId });
      }
    },
    [loadMods]
  );

  const checkForUpdates = useCallback(async () => {
    try {
      return await invoke<UpdateAvailable[]>("check_for_updates");
    } catch (err) {
      toast.error(`Failed to check for updates: ${err}`);
      return [];
    }
  }, []);

  const applyUpdate = useCallback((update: UpdateAvailable) => {
    enqueueDownload({
      jobId: update.modId,
      title: update.modName,
      pageUrl: update.pageUrl,
    });
  }, []);

  // Note: the "mod-installed" listener lives in App, mounted once. Registering
  // it here would fire one full library reload per mounted consumer.

  return {
    mods,
    conflicts,
    isLoading,
    error,
    loadMods,
    toggleMod,
    deleteMod,
    applyLoadOrder,
    refreshConflicts,
    checkForUpdates,
    applyUpdate,
  };
}
