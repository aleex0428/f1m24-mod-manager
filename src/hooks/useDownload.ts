import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";
import { isActiveStatus, type DownloadStatus } from "../types";

/** Error string the backend sends when Overtake asks for a login/captcha. */
const ERR_AUTH_REQUIRED = "AUTH_REQUIRED";
/** How long a finished job stays visible in the Pit Wall. */
const COMPLETED_TTL_MS = 8000;

interface StartedPayload {
  id: string;
  filename: string;
  url: string;
}
interface FinishedPayload {
  id: string;
  filename: string;
}
interface ErrorPayload {
  id: string;
  error: string;
  url?: string;
}
interface ProgressPayload {
  id: string;
  downloaded: number;
  total: number;
  percentage: number;
  speed: number;
}
interface StatusPayload {
  id: string;
  status: DownloadStatus;
}

/**
 * Owns the serial download queue.
 *
 * It deliberately subscribes to the store imperatively instead of through a
 * React selector: progress events land several times per second and must not
 * re-render the application tree.
 */
export function useDownload() {
  const startingRef = useRef(false);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ─── Queue pump ───────────────────────────────────────────
  useEffect(() => {
    const pump = () => {
      const state = useModStore.getState();
      if (state.isQueuePaused || startingRef.current) return;

      const jobs = Object.values(state.jobs);
      if (jobs.some((j) => isActiveStatus(j.status))) return;

      const next = jobs.find((j) => j.status === "queued");
      if (!next) return;

      startingRef.current = true;
      state.updateJob(next.jobId, {
        status: "initiating",
        error: undefined,
        downloadedBytes: 0,
        speed: 0,
      });

      invoke("start_download_job", {
        jobId: next.jobId,
        downloadUrl: next.downloadUrl,
        pageUrl: next.pageUrl,
      })
        .catch((err) => {
          const message = String(err);
          useModStore.getState().updateJob(next.jobId, {
            status: "error",
            error: message,
          });
          useModStore.getState().pushNotification("error", "Download failed to start", message);
          toast.error(`Download failed to start: ${message}`);
        })
        .finally(() => {
          startingRef.current = false;
        });
    };

    const unsubscribe = useModStore.subscribe(pump);
    pump();
    return unsubscribe;
  }, []);

  // ─── Backend events ───────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const timers = timersRef.current;

    const register = <T,>(event: string, handler: (payload: T) => void) => {
      listen<T>(event, (e) => handler(e.payload))
        .then((fn) => {
          if (disposed) fn();
          else unlisteners.push(fn);
        })
        .catch(() => {
          // No Tauri runtime (e.g. plain browser preview) — nothing to clean up.
        });
    };

    const scheduleRemoval = (jobId: string) => {
      const existing = timers.get(jobId);
      if (existing) clearTimeout(existing);
      timers.set(
        jobId,
        setTimeout(() => {
          timers.delete(jobId);
          useModStore.getState().removeJob(jobId);
        }, COMPLETED_TTL_MS)
      );
    };

    register<{ logged_in: boolean }>("auth-status", ({ logged_in }) => {
      const store = useModStore.getState();
      store.setLoggedIn(logged_in);
      if (logged_in) {
        store.setQueuePaused(false);
        store.requeueLoginRequiredJobs();
      }
    });

    register("overtake_login_success", () => {
      const store = useModStore.getState();
      store.setLoggedIn(true);
      store.setQueuePaused(false);
      store.requeueLoginRequiredJobs();
    });

    register("auth-required", () => {
      useModStore.getState().setQueuePaused(true);
    });

    register<StartedPayload>("download-started", ({ id, filename }) => {
      useModStore.getState().updateJob(id, {
        status: "downloading",
        progress: 0,
        downloadedBytes: 0,
        filename,
      });
    });

    register<ProgressPayload>("download-progress", ({ id, downloaded, speed }) => {
      useModStore.getState().updateJob(id, { downloadedBytes: downloaded, speed });
    });

    register<StatusPayload>("download-status", ({ id, status }) => {
      useModStore.getState().updateJob(id, { status });
    });

    register<FinishedPayload>("download-finished", ({ id, filename }) => {
      const store = useModStore.getState();
      store.updateJob(id, { progress: 100, status: "completed", speed: 0 });
      store.pushNotification("success", "Mod installed", filename);
      toast.success(`${filename} installed`, { duration: 5000 });
      scheduleRemoval(id);
    });

    register<ErrorPayload>("download-error", ({ id, error }) => {
      const store = useModStore.getState();

      if (error === ERR_AUTH_REQUIRED) {
        store.updateJob(id, {
          status: "login_required",
          error: "Waiting for you to sign in to Overtake.gg",
        });
        store.setQueuePaused(true);
        store.setLoggedIn(false);
        store.pushNotification(
          "info",
          "Sign-in required",
          "The download will resume automatically once you are signed in."
        );
        return;
      }

      const message = error || "Download failed";
      store.updateJob(id, { status: "error", error: message, speed: 0 });
      store.pushNotification("error", "Download failed", message);
      toast.error(message);
    });

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);
}

/** Cancel a job in the backend and drop it from the queue. */
export async function cancelDownload(jobId: string) {
  const store = useModStore.getState();
  try {
    await invoke("cancel_download_job", { jobId });
  } catch {
    // The job may already be gone in the backend — the UI state still wins.
  }
  store.removeJob(jobId);
}

/** Put a failed job back at the end of the queue. */
export function retryDownload(jobId: string) {
  useModStore.getState().updateJob(jobId, {
    status: "queued",
    error: undefined,
    downloadedBytes: 0,
    speed: 0,
    progress: 0,
  });
}
