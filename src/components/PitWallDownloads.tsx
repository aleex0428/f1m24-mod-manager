import { useEffect, useRef } from "react";
import { useModStore } from "../store/modStore";
import { linkOvertakeAccount } from "../lib/auth";
import { cancelDownload, retryDownload } from "../hooks/useDownload";
import { formatBytes, formatSpeed } from "../lib/format";
import { Icon } from "./Icon";
import { EmptyState, NoDownloadsArt } from "./EmptyState";
import { isActiveStatus, type DownloadJob, type DownloadStatus } from "../types";

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: "Queued",
  login_required: "Sign-in required",
  initiating: "Starting",
  connecting: "Connecting",
  downloading: "Downloading",
  verifying: "Verifying",
  installing: "Installing",
  awaiting_input: "Waiting for you",
  completed: "Installed",
  error: "Failed",
  canceled: "Canceled",
};

const STATUS_TONE: Record<DownloadStatus, string> = {
  queued: "text-text-muted",
  login_required: "text-warning",
  initiating: "text-info",
  connecting: "text-info",
  downloading: "text-info",
  verifying: "text-info",
  installing: "text-info",
  awaiting_input: "text-warning",
  completed: "text-success",
  error: "text-danger",
  canceled: "text-text-muted",
};

const DOT_TONE: Record<DownloadStatus, string> = {
  queued: "bg-text-muted",
  login_required: "bg-warning animate-pulse",
  initiating: "bg-info animate-pulse",
  connecting: "bg-info animate-pulse",
  downloading: "bg-info animate-pulse",
  verifying: "bg-info animate-pulse",
  installing: "bg-info animate-pulse",
  awaiting_input: "bg-warning animate-pulse",
  completed: "bg-success",
  error: "bg-danger",
  canceled: "bg-text-muted",
};

export function PitWallDownloads({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const jobs = useModStore((s) => s.jobs);
  const isQueuePaused = useModStore((s) => s.isQueuePaused);
  const clearInactiveJobs = useModStore((s) => s.clearInactiveJobs);
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const allJobs = Object.values(jobs);
  const activeCount = allJobs.filter((j) => isActiveStatus(j.status)).length;

  useEffect(() => {
    if (!isOpen) return;

    // The drawer is not modal — the app stays usable behind it — but focus
    // still has to move in, or the panel is unreachable by keyboard, and come
    // back out when it closes.
    restoreRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-menu animate-fade-in bg-black/60"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        ref={panelRef}
        role="dialog"
        aria-label="Download queue"
        className={`fixed right-0 top-0 z-drawer flex h-full w-[22rem] flex-col border-l border-border bg-bg-secondary shadow-elev-2 transition-transform duration-slow ease-out-expo ${
          isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
        aria-hidden={!isOpen}
      >
        <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-4">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.18em] text-text-primary">
              Pit Wall
            </h2>
            {/* Announced, so a screen reader hears the queue change without
                having to poll the list. */}
            <p aria-live="polite" className="mt-0.5 text-2xs text-text-muted">
              {activeCount > 0 ? `${activeCount} in progress` : "Idle"}
              {isQueuePaused && " · queue paused"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {allJobs.length > 0 && (
              <button
                onClick={clearInactiveJobs}
                className="btn-subtle h-8 !px-2 text-xs"
                title="Clear finished jobs"
              >
                Clear
              </button>
            )}
            <button onClick={onClose} className="btn-icon-sm" title="Close" aria-label="Close the download queue">
              <Icon name="close" size={16} />
            </button>
          </div>
        </header>

        {isQueuePaused && (
          <button
            onClick={linkOvertakeAccount}
            className="mx-3 mt-3 flex items-center gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-left transition-colors hover:bg-warning/15"
          >
            <Icon name="lock" size={16} className="text-warning" />
            <span className="text-xs leading-snug text-warning">
              Queue paused — sign in to Overtake.gg to resume.
            </span>
          </button>
        )}

        {allJobs.length === 0 ? (
          <div className="flex-1">
            <EmptyState
              art={<NoDownloadsArt />}
              title="Pit lane is empty"
              description="Anything you install from Browse appears here while it downloads, and stays until you clear it."
            />
          </div>
        ) : (
          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {allJobs.map((job) => (
              <JobCard key={job.jobId} job={job} />
            ))}
          </div>
        )}
      </aside>
    </>
  );
}

function JobCard({ job }: { job: DownloadJob }) {
  const active = isActiveStatus(job.status);
  const showBar = active && job.status !== "initiating";

  return (
    <article className="panel overflow-hidden bg-surface p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-text-primary" title={job.title}>
          {job.title}
        </h3>
        <div className="flex flex-shrink-0 items-center gap-1">
          {(job.status === "error" || job.status === "canceled") && (
            <button
              onClick={() => retryDownload(job.jobId)}
              className="btn-icon-sm h-6 w-6"
              title="Retry"
              aria-label={`Retry ${job.title}`}
            >
              <Icon name="refresh" size={14} />
            </button>
          )}
          <button
            onClick={() => cancelDownload(job.jobId)}
            className="btn-icon-sm h-6 w-6"
            title={active ? "Cancel" : "Remove"}
            aria-label={`${active ? "Cancel" : "Remove"} ${job.title}`}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONE[job.status]}`} />
          <span className={`font-medium ${STATUS_TONE[job.status]}`}>{STATUS_LABEL[job.status]}</span>
        </span>

        {job.status === "downloading" && (
          <span className="font-mono text-text-secondary">
            {formatBytes(job.downloadedBytes ?? 0)}
            {job.speed ? ` · ${formatSpeed(job.speed)}` : ""}
          </span>
        )}
      </div>

      {/* The webview never reports a total size, so anything in flight gets an
          honest indeterminate sweep instead of a made-up percentage. */}
      {showBar && (
        <div className="progress-track">
          <div className="progress-indeterminate" />
        </div>
      )}

      {job.status === "completed" && (
        <div className="progress-track">
          <div className="progress-fill" style={{ width: "100%" }} />
        </div>
      )}

      {job.error && (
        <p
          className="selectable mt-2 line-clamp-3 text-xs leading-snug text-danger/90"
          title={job.error}
        >
          {job.error}
        </p>
      )}
    </article>
  );
}
