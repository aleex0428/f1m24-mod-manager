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

/**
 * Automatic retries before a download is left as failed.
 *
 * There is no resuming to be had: downloads run through the ghost webview so
 * they carry the user's Cloudflare session, and Tauri's download API exposes
 * only the destination path and a finished/failed flag — no handle on the
 * transfer, no Range header, no pause. Replacing it with our own HTTP client
 * would mean losing the session that makes downloading possible at all.
 *
 * So a broken transfer restarts. What that buys is that the *common* failure —
 * a moment of bad connectivity — resolves itself instead of leaving a red row
 * for the user to notice and press Retry on.
 */
const MAX_AUTO_RETRIES = 2;
/** 4s then 12s. Long enough for a blip to pass, short enough to still care. */
const RETRY_BACKOFF_MS = [4000, 12000];

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

      const job = store.jobs[id];
      const attempts = job?.retries ?? 0;
      const message = error || "Download failed";

      // Retry the transient case automatically. A job that has already failed
      // twice is left alone: something is wrong that waiting will not fix, and
      // an endless retry loop hides that.
      if (attempts < MAX_AUTO_RETRIES) {
        const wait = RETRY_BACKOFF_MS[attempts] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        const seconds = Math.round(wait / 1000);

        // It has to stay `error` for the wait, not `queued`: the pump starts
        // anything queued the moment a slot frees, so queueing it here would
        // retry instantly and the backoff would be decorative. `error` is not
        // an active status, so the rest of the queue still moves.
        store.updateJob(id, {
          status: "error",
          retries: attempts + 1,
          error: `${message} — retrying in ${seconds}s`,
          speed: 0,
          downloadedBytes: 0,
        });

        const timer = setTimeout(() => {
          timers.delete(`retry-${id}`);
          const current = useModStore.getState().jobs[id];
          // Gone, cancelled, or already retried by hand: leave it be.
          if (current && current.status === "error") {
            useModStore.getState().updateJob(id, { status: "queued", error: undefined });
          }
        }, wait);
        timers.set(`retry-${id}`, timer);
        return;
      }

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
    // Asking by hand is a fresh start: the automatic attempts already spent
    // should not count against a retry the user chose to make.
    retries: 0,
  });
}
