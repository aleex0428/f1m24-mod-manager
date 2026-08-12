import { memo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ConflictBadge } from "./ConflictBadge";
import { ModDetailsModal } from "./ModDetailsModal";
import { formatBytes, formatDate } from "../lib/format";
import type { ConflictStanding, Mod, UpdateAvailable } from "../types";

interface ModCardProps {
  mod: Mod;
  /** How this mod fares against others claiming the same pakchunks. */
  standing?: ConflictStanding;
  update?: UpdateAvailable;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate?: (update: UpdateAvailable) => void;
  onOpenFolder?: () => void;
  onMove?: (id: string, direction: "up" | "down") => void;
}

function ModCardBase({
  mod,
  standing,
  update,
  position,
  isFirst,
  isLast,
  onToggle,
  onDelete,
  onUpdate,
  onOpenFolder,
  onMove,
}: ModCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mod.id,
  });
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const contested = standing?.chunks ?? [];
  const overriddenBy = standing?.overriddenBy;
  const thumbnail = mod.imageUrl || mod.thumbnailUrl;

  return (
    <>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`group relative flex animate-slide-up items-stretch overflow-hidden rounded-2xl border bg-surface/60 transition-colors duration-200 ${
          mod.enabled
            ? "border-border hover:border-f1red/40"
            : "border-border-subtle opacity-70 hover:opacity-100"
        } ${isDragging ? "z-50 border-f1red/60 shadow-f1-strong" : "shadow-card"}`}
      >
        {/* Active accent rail */}
        <span
          className={`absolute inset-y-0 left-0 w-[3px] transition-colors ${
            mod.enabled ? "bg-f1red" : "bg-transparent"
          }`}
        />

        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="flex flex-shrink-0 cursor-grab items-center px-2.5 pl-4 text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
          title="Drag to change load order"
          aria-label="Reorder"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <circle cx="7" cy="5" r="1.5" />
            <circle cx="13" cy="5" r="1.5" />
            <circle cx="7" cy="10" r="1.5" />
            <circle cx="13" cy="10" r="1.5" />
            <circle cx="7" cy="15" r="1.5" />
            <circle cx="13" cy="15" r="1.5" />
          </svg>
        </button>

        {/* Load order */}
        <div className="flex flex-shrink-0 items-center gap-1 pr-3">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-lg border font-mono text-sm font-bold ${
              mod.enabled
                ? "border-f1red/25 bg-f1red/10 text-f1red"
                : "border-border bg-surface-raised text-text-muted"
            }`}
          >
            {position.toString().padStart(2, "0")}
          </span>

          {/* Dragging is fine for a nudge; these are for moving across a long
              list without fighting the scroll. */}
          {onMove && (
            <div className="flex flex-col">
              <button
                onClick={() => onMove(mod.id, "up")}
                disabled={isFirst}
                className="flex h-[18px] w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:pointer-events-none disabled:opacity-25"
                title="Move up"
                aria-label="Move up"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                onClick={() => onMove(mod.id, "down")}
                disabled={isLast}
                className="flex h-[18px] w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:pointer-events-none disabled:opacity-25"
                title="Move down"
                aria-label="Move down"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Thumbnail */}
        <div className="flex flex-shrink-0 items-center py-3">
          <div className="h-16 w-16 overflow-hidden rounded-xl border border-border bg-bg-elevated">
            {thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-text-muted/50">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.2}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <button
          onClick={() => setIsDetailsOpen(true)}
          className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-4 py-3 text-left"
        >
          <div className="flex min-w-0 items-center gap-2">
            <h3
              className={`truncate text-[15px] font-semibold ${
                mod.enabled ? "text-text-primary" : "text-text-secondary"
              }`}
              title={mod.name}
            >
              {mod.name}
            </h3>
            {mod.version && (
              <span className="chip flex-shrink-0 border-border bg-surface-raised text-text-secondary">
                v{mod.version}
              </span>
            )}
            {update && (
              <span className="chip flex-shrink-0 border-f1red/30 bg-f1red/15 text-f1red">
                Update {update.newVersion}
              </span>
            )}
            {contested.length > 0 &&
              (overriddenBy ? (
                <ConflictBadge chunks={contested} overriddenBy={overriddenBy} />
              ) : (
                <span
                  className="chip flex-shrink-0 border-success/25 bg-success/10 text-success"
                  title={`This mod wins pakchunk ${contested.join(", ")} because it sits higher in the load order`}
                >
                  Applied
                </span>
              ))}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
            {mod.author && <span className="truncate">by {mod.author}</span>}
            <span>{mod.sourceUrl ? "Overtake.gg" : "Local file"}</span>
            {formatDate(mod.installedAt) && <span>{formatDate(mod.installedAt)}</span>}
            <span className="font-mono">
              {mod.pakFiles.length} file{mod.pakFiles.length === 1 ? "" : "s"}
            </span>
            {mod.sizeBytes > 0 && <span className="font-mono">{formatBytes(mod.sizeBytes)}</span>}
          </div>
        </button>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-center gap-2 px-4">
          {update && onUpdate && (
            <button
              onClick={() => onUpdate(update)}
              className="btn-ghost h-9 !px-3 !text-xs border-f1red/30 text-f1red hover:bg-f1red/10 hover:text-f1red"
              title={`Update to ${update.newVersion}`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              Update
            </button>
          )}

          <label className="toggle-switch" title={mod.enabled ? "Disable mod" : "Enable mod"}>
            <input
              type="checkbox"
              checked={mod.enabled}
              onChange={(e) => onToggle(mod.id, e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>

          <div className="flex overflow-hidden rounded-lg border border-border">
            {onOpenFolder && (
              <button
                onClick={onOpenFolder}
                className="border-r border-border p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
                title="Open ~mods folder"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              </button>
            )}
            <button
              onClick={() => (confirmDelete ? onDelete(mod.id) : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
              className={`p-2 transition-colors ${
                confirmDelete
                  ? "bg-danger/15 text-danger"
                  : "text-text-muted hover:bg-danger/10 hover:text-danger"
              }`}
              title={confirmDelete ? "Click again to confirm" : "Uninstall mod"}
            >
              {confirmDelete ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {isDetailsOpen && (
        <ModDetailsModal mod={mod} isOpen onClose={() => setIsDetailsOpen(false)} />
      )}
    </>
  );
}

export const ModCard = memo(ModCardBase);
