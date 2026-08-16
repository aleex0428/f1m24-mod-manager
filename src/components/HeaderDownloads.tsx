import { Icon } from "./Icon";
import { selectActiveJobCount, useModStore } from "../store/modStore";
import { formatBytes, formatSpeed } from "../lib/format";
import { isActiveStatus } from "../types";

/**
 * Download state in the header.
 *
 * A queue you have to open a drawer to see is a queue you keep opening. When
 * something is in flight this widens into a live strip — what is downloading,
 * how much has arrived, how fast — and shrinks back to a plain button when the
 * queue is idle.
 *
 * It is a component of its own so the progress ticks re-render this strip and
 * nothing else; the header, the sidebar and the current page are untouched.
 */
export function HeaderDownloads({ onOpen }: { onOpen: () => void }) {
  const activeCount = useModStore(selectActiveJobCount);
  const isQueuePaused = useModStore((s) => s.isQueuePaused);

  // Primitives only. A selector returning a fresh object would re-render on
  // every store write, ticking or not.
  const activeTitle = useModStore(
    (s) => Object.values(s.jobs).find((j) => isActiveStatus(j.status))?.title
  );
  const activeBytes = useModStore(
    (s) => Object.values(s.jobs).find((j) => isActiveStatus(j.status))?.downloadedBytes
  );
  const activeSpeed = useModStore(
    (s) => Object.values(s.jobs).find((j) => isActiveStatus(j.status))?.speed
  );

  if (activeCount === 0) {
    return (
      <button
        onClick={onOpen}
        className={`btn-icon relative ${isQueuePaused ? "text-warning" : ""}`}
        title={isQueuePaused ? "Queue paused — sign in to resume (Ctrl+J)" : "Downloads (Ctrl+J)"}
        aria-label="Downloads"
      >
        <Icon name="download" size={18} />
        {isQueuePaused && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warning" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={onOpen}
      className="group flex h-9 max-w-[16rem] items-center gap-2.5 rounded-xl border border-border bg-surface/70 px-3 text-left transition-colors duration-fast hover:border-border-strong hover:bg-surface-raised"
      title="Open the download queue (Ctrl+J)"
    >
      <span className="relative flex-shrink-0 text-info">
        <Icon name="download" size={16} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-medium text-text-primary">
            {activeTitle ?? "Downloading"}
          </span>
          {activeCount > 1 && (
            <span className="flex-shrink-0 font-mono text-2xs text-text-muted">
              +{activeCount - 1}
            </span>
          )}
        </span>
        {/* The webview never reports a total, so this is an honest sweep with
            the byte count beside it rather than an invented percentage. */}
        <span className="mt-0.5 flex items-center gap-2">
          <span className="progress-track progress-track-thin block w-full">
            <span className="progress-indeterminate block" />
          </span>
        </span>
      </span>

      {(activeBytes ?? 0) > 0 && (
        <span className="flex-shrink-0 text-right font-mono text-2xs leading-tight text-text-muted">
          {formatBytes(activeBytes ?? 0)}
          {activeSpeed ? <span className="block">{formatSpeed(activeSpeed)}</span> : null}
        </span>
      )}
    </button>
  );
}
