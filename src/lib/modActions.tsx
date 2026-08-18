import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { Icon } from "../components/Icon";
import { useModStore } from "../store/modStore";

/** How long the removed files stay recoverable in the interface. */
const UNDO_WINDOW_MS = 9000;

/**
 * Uninstall a mod, with a way back.
 *
 * The previous flow asked for a second click on the same button before doing
 * anything — which protects nobody, because the second click is reflex, and
 * costs everybody a click. This does the thing immediately and offers to put
 * it back, which is the trade people actually want: the mistake is cheap to
 * reverse, so the common case does not have to be defended against.
 *
 * The backend keeps the files (see `delete_mod`'s `undoable` flag); this only
 * decides how long the offer stays on screen.
 */
export async function uninstallMod(
  modId: string,
  modName: string,
  reload: () => Promise<void> | void
): Promise<void> {
  try {
    await invoke("delete_mod", { modId, undoable: true });
  } catch (err) {
    toast.error(`Could not remove ${modName}: ${err}`);
    return;
  }

  await reload();

  toast.custom(
    (t) => (
      <div
        className={`toast-custom flex items-center gap-3 px-3.5 py-3 text-sm ${
          t.visible ? "animate-slide-up" : "opacity-0"
        }`}
      >
        <Icon name="check-circle" size={16} className="text-success" />
        <span className="min-w-0 flex-1 truncate text-text-secondary">
          Removed <span className="font-medium text-text-primary">{modName}</span>
        </span>
        <button
          onClick={async () => {
            toast.dismiss(t.id);
            await restoreMod(modId, modName, reload);
          }}
          className="btn-ghost -my-1 !py-1.5 !text-xs"
        >
          <Icon name="undo" size={14} />
          Undo
        </button>
      </div>
    ),
    { duration: UNDO_WINDOW_MS, id: `undo-${modId}` }
  );
}

/** Put back a mod removed in this session. */
export async function restoreMod(
  modId: string,
  modName: string,
  reload: () => Promise<void> | void
): Promise<void> {
  try {
    await invoke("restore_mod", { modId });
    await reload();
    toast.success(`${modName} restored`);
  } catch (err) {
    // The bin is emptied on startup, so this is what a restore attempted after
    // a restart looks like. Say so rather than showing a raw path error.
    toast.error(String(err));
  }
}

/** Uninstall several mods at once, with a single undo covering all of them. */
export async function uninstallMods(
  mods: { id: string; name: string }[],
  reload: () => Promise<void> | void
): Promise<void> {
  const removed: { id: string; name: string }[] = [];

  for (const mod of mods) {
    try {
      await invoke("delete_mod", { modId: mod.id, undoable: true });
      removed.push(mod);
    } catch {
      // Keep going: one file locked by the game must not strand the rest.
    }
  }

  await reload();

  const failed = mods.length - removed.length;
  if (removed.length === 0) {
    toast.error("Could not remove those mods");
    return;
  }

  toast.custom(
    (t) => (
      <div
        className={`toast-custom flex items-center gap-3 px-3.5 py-3 text-sm ${
          t.visible ? "animate-slide-up" : "opacity-0"
        }`}
      >
        <Icon name="check-circle" size={16} className="text-success" />
        <span className="min-w-0 flex-1 text-text-secondary">
          Removed {removed.length} mod{removed.length === 1 ? "" : "s"}
          {failed > 0 && <span className="text-warning"> · {failed} could not be removed</span>}
        </span>
        <button
          onClick={async () => {
            toast.dismiss(t.id);
            for (const mod of removed) {
              await invoke("restore_mod", { modId: mod.id }).catch(() => {});
            }
            await reload();
            toast.success(`${removed.length} mods restored`);
          }}
          className="btn-ghost -my-1 !py-1.5 !text-xs"
        >
          <Icon name="undo" size={14} />
          Undo
        </button>
      </div>
    ),
    { duration: UNDO_WINDOW_MS, id: "undo-bulk" }
  );
}

/** Pin or unpin a mod, optimistically. */
export async function setModFavourite(modId: string, favourite: boolean): Promise<void> {
  const store = useModStore.getState();
  store.updateMod(modId, { favourite });
  try {
    await invoke("set_mod_favourite", { modId, favourite });
  } catch (err) {
    useModStore.getState().updateMod(modId, { favourite: !favourite });
    toast.error(String(err));
  }
}

/** Replace a mod's tags. The backend normalises and returns what it stored. */
export async function setModTags(modId: string, tags: string[]): Promise<void> {
  const previous = useModStore.getState().mods.find((m) => m.id === modId)?.tags ?? [];
  useModStore.getState().updateMod(modId, { tags });
  try {
    const stored = await invoke<string[]>("set_mod_tags", { modId, tags });
    // Trust the backend's version: it trims, de-duplicates and caps.
    useModStore.getState().updateMod(modId, { tags: stored });
  } catch (err) {
    useModStore.getState().updateMod(modId, { tags: previous });
    toast.error(String(err));
  }
}

/** Save the user's note for a mod. */
export async function setModNotes(modId: string, notes: string): Promise<void> {
  const previous = useModStore.getState().mods.find((m) => m.id === modId)?.notes;
  useModStore.getState().updateMod(modId, { notes: notes.trim() || undefined });
  try {
    await invoke("set_mod_notes", { modId, notes });
  } catch (err) {
    useModStore.getState().updateMod(modId, { notes: previous });
    toast.error(String(err));
  }
}

/** Enable or disable one mod, optimistically, sharing the store's rollback. */
export async function setModEnabled(modId: string, enabled: boolean): Promise<void> {
  const store = useModStore.getState();
  store.updateMod(modId, { enabled });
  try {
    await invoke("toggle_mod", { modId, enabled });
    const conflicts = await invoke("detect_conflicts").catch(() => null);
    if (conflicts) useModStore.getState().setConflicts(conflicts as never);
  } catch (err) {
    useModStore.getState().updateMod(modId, { enabled: !enabled });
    toast.error(`Failed to toggle mod: ${err}`);
  }
}
