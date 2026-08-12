import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";

/** Wait a moment after launch so the check never competes with first paint. */
export const STARTUP_CHECK_DELAY_MS = 4000;

/**
 * The pending update lives at module scope: it is a handle to a download, not
 * render state, and there is only ever one app being updated.
 */
let pendingUpdate: Update | null = null;

/**
 * Look for a new release.
 *
 * `silent` is used for the automatic check on startup: an endpoint that is
 * unreachable, unconfigured or rate-limited must never greet the user with an
 * error dialog. Explicit checks from Settings do report failures.
 */
export async function checkForAppUpdate(silent: boolean): Promise<void> {
  const store = useModStore.getState();
  store.setAppUpdate({ stage: "checking", error: undefined });

  try {
    const update = await check();

    if (!update) {
      pendingUpdate = null;
      store.setAppUpdate({ stage: "idle", version: undefined, notes: undefined });
      if (!silent) toast.success("You are on the latest version");
      return;
    }

    pendingUpdate = update;
    useModStore.getState().setAppUpdate({
      stage: "available",
      version: update.version,
      notes: update.body ?? undefined,
    });

    if (silent) {
      useModStore
        .getState()
        .pushNotification(
          "info",
          `Version ${update.version} is available`,
          "Install it from Settings."
        );
    }
  } catch (err) {
    const message = String(err);
    pendingUpdate = null;
    useModStore.getState().setAppUpdate({
      stage: silent ? "idle" : "error",
      error: silent ? undefined : message,
    });
    if (!silent) toast.error(`Could not check for updates: ${message}`);
  }
}

/** Download and install the pending update, then restart. */
export async function installAppUpdate(): Promise<void> {
  const update = pendingUpdate;
  if (!update) return;

  const store = useModStore.getState();
  store.setAppUpdate({ stage: "downloading", progress: 0, error: undefined });

  try {
    let downloaded = 0;
    let total = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          useModStore.getState().setAppUpdate({
            stage: "downloading",
            progress: total > 0 ? Math.round((downloaded / total) * 100) : undefined,
          });
          break;
        case "Finished":
          useModStore.getState().setAppUpdate({ stage: "ready", progress: 100 });
          break;
      }
    });

    useModStore.getState().setAppUpdate({ stage: "ready", progress: 100 });
    toast.success("Update installed — restarting…");
    // Let the toast land before the process goes away.
    setTimeout(() => {
      relaunch().catch(() => {});
    }, 1200);
  } catch (err) {
    const message = String(err);
    useModStore.getState().setAppUpdate({ stage: "error", error: message });
    toast.error(`Update failed: ${message}`);
  }
}
