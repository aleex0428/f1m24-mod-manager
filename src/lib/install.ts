import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";
import type { InstallOutcome } from "../types";

/** Extensions the installer knows how to unpack. */
export const INSTALLABLE = [".zip", ".rar", ".7z", ".pak"];

export function isInstallable(path: string): boolean {
  const lower = path.toLowerCase();
  return INSTALLABLE.some((ext) => lower.endsWith(ext));
}

function fileName(path: string): string {
  return path.split(/[\/]/).pop() ?? path;
}

/**
 * Install one local archive.
 *
 * Shared by the "Install file" button and by dropping a file on the window, so
 * both behave identically — including stopping to ask which version to use.
 * The library refreshes itself: the backend emits `mod-installed`.
 */
export async function installLocalFile(path: string): Promise<boolean> {
  const name = fileName(path);
  const toastId = toast.loading(`Installing ${name}…`);

  try {
    const outcome = await invoke<InstallOutcome>("install_mod", { zipPath: path });

    if (outcome.kind === "needsVariant") {
      toast.dismiss(toastId);
      useModStore.getState().setPendingVariant({
        stagingId: outcome.stagingId,
        title: name,
        variants: outcome.variants,
      });
      return true;
    }

    toast.success(`${name} installed`, { id: toastId });
    return true;
  } catch (err) {
    toast.error(`${name}: ${err}`, { id: toastId });
    return false;
  }
}

/**
 * Install several dropped files, one after another.
 *
 * Sequential on purpose: each install moves files into ~mods and renames on
 * collision, so running two at once could hand both the same free name.
 */
export async function installLocalFiles(paths: string[]): Promise<void> {
  const installable = paths.filter(isInstallable);
  const rejected = paths.length - installable.length;

  if (installable.length === 0) {
    toast.error(
      rejected === 1
        ? "That file is not a mod archive (.zip, .rar, .7z or .pak)"
        : "None of those files are mod archives (.zip, .rar, .7z or .pak)"
    );
    return;
  }

  if (rejected > 0) {
    toast(`Skipping ${rejected} file${rejected === 1 ? "" : "s"} that ${rejected === 1 ? "is" : "are"} not a mod`, {
      icon: "⏭️",
    });
  }

  for (const path of installable) {
    // A parked variant question must be answered before the next archive is
    // unpacked, otherwise its staging folder would be replaced.
    if (useModStore.getState().pendingVariant) break;
    await installLocalFile(path);
  }
}
