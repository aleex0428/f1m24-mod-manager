import { useEffect } from "react";
import { useModStore } from "../store/modStore";
import { linkOvertakeAccount } from "../lib/auth";
import { cancelDownload, retryDownload } from "../hooks/useDownload";
import { formatBytes, formatSpeed } from "../lib/format";
import { isActiveStatus, type DownloadJob, type DownloadStatus } from "../types";

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: "Queued",
  login_required: "Sign-in required",
  initiating: "Starting",
  connecting: "Connecting",
  downloading: "Downloading",
  verifying: "Verifying",
  installing: "Installing",
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
  completed: "bg-success",
  error: "bg-danger",
  canceled: "bg-text-muted",
};

export function PitWallDownloads({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const jobs = useModStore((s) => s.jobs);
  const isQueuePaused = useModStore((s) => s.isQueuePaused);
  const clearInactiveJobs = useModStore((s) => s.clearInactiveJobs);

  const allJobs = Object.values(jobs);
  const activeCount = allJobs.filter((j) => isActiveStatus(j.status)).length;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 animate-fade-in bg-black/60"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-[22rem] flex-col border-l border-border bg-bg-secondary shadow-surface transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
        aria-hidden={!isOpen}
      >
        <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-4">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.18em] text-text-primary">
              Pit Wall
            </h2>
            <p className="mt-0.5 text-[11px] text-text-muted">
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
            <button onClick={onClose} className="btn-subtle h-8 w-8 !px-0" title="Close">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        {isQueuePaused && (
          <button
            onClick={linkOvertakeAccount}
            className="mx-3 mt-3 flex items-center gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-left transition-colors hover:bg-warning/15"
          >
            <svg className="h-4 w-4 flex-shrink-0 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <span className="text-xs leading-snug text-warning">
              Queue paused — sign in to Overtake.gg to resume.
            </span>
          </button>
        )}

        {allJobs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-text-muted">
            <svg className="mb-3 h-12 w-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            <p className="text-sm font-medium text-text-secondary">No downloads</p>
            <p className="mt-1 text-xs">Install a mod from Browse to see it here.</p>
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
              className="btn-subtle h-6 w-6 !px-0"
              title="Retry"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
          <button
            onClick={() => cancelDownload(job.jobId)}
            className="btn-subtle h-6 w-6 !px-0"
            title={active ? "Cancel" : "Remove"}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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
            {formatBytes(job.downloadedBytes)}
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
        <p className="mt-2 line-clamp-3 text-xs leading-snug text-danger/90" title={job.error}>
          {job.error}
        </p>
      )}
    </article>
  );
}
