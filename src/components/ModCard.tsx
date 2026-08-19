import { memo, useState, type MouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ConflictBadge } from "./ConflictBadge";
import { IntegrityBadge } from "./IntegrityBadge";
import { ModDetailsModal } from "./ModDetailsModal";
import { Icon } from "./Icon";
import { setModFavourite } from "../lib/modActions";
import { ModCover } from "./ModCover";
import { formatBytes, formatDate } from "../lib/format";
import type { ConflictStanding, Mod, UpdateAvailable } from "../types";

export interface ModCardProps {
  mod: Mod;
  /** How this mod fares against others claiming the same pakchunks. */
  standing?: ConflictStanding;
  update?: UpdateAvailable;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  /** Row index within the visible list, for the staggered entrance. */
  index: number;
  compact: boolean;
  selected: boolean;
  /** True while anything at all is selected, which reveals every checkbox. */
  selectionActive: boolean;
  /** Where the dragged row would land relative to this one. */
  dropEdge?: "above" | "below";
  onSelect: (id: string, event: MouseEvent) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate?: (update: UpdateAvailable) => void;
  onOpenFolder?: () => void;
  onMove?: (id: string, direction: "up" | "down") => void;
  onContextMenu?: (event: MouseEvent, mod: Mod) => void;
}

function ModCardBase({
  mod,
  standing,
  update,
  position,
  isFirst,
  isLast,
  index,
  compact,
  selected,
  selectionActive,
  dropEdge,
  onSelect,
  onToggle,
  onDelete,
  onUpdate,
  onOpenFolder,
  onMove,
  onContextMenu,
}: ModCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: mod.id,
  });
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const contested = standing?.chunks ?? [];
  const overriddenBy = standing?.overriddenBy;
  const thumbnail = mod.imageUrl || mod.thumbnailUrl;

  return (
    <>
      <div
        ref={setNodeRef}
        style={
          {
            transform: CSS.Transform.toString(transform),
            transition,
            "--i": index,
          } as React.CSSProperties
        }
        data-row-id={mod.id}
        onContextMenu={(e) => onContextMenu?.(e, mod)}
        className={`stagger group relative flex items-stretch overflow-hidden rounded-2xl border bg-surface/60 transition-colors duration-base ${
          dropEdge ? `drop-indicator drop-indicator-${dropEdge}` : ""
        } ${
          selected
            ? "border-f1red/60 bg-f1red/[0.07]"
            : mod.enabled
              ? "border-border hover:border-f1red/40"
              : "border-border-subtle opacity-70 hover:opacity-100"
        } ${isDragging ? "z-50 border-f1red/60 shadow-f1-strong" : "shadow-elev-1"}`}
      >
        {/* The rail says what this mod is doing, at a glance and without
            reading: solid red for applying, amber for enabled-but-covered,
            nothing for disabled. A mod that is on yet has no effect is the
            state people misread most often. */}
        <span
          className={`absolute inset-y-0 left-0 w-[3px] transition-colors ${
            !mod.enabled ? "bg-transparent" : overriddenBy ? "bg-warning/70" : "bg-f1red"
          }`}
          title={
            overriddenBy
              ? `Enabled, but covered by "${overriddenBy}" — no effect in game`
              : undefined
          }
        />

        {/* Selection. Hidden until it is relevant — a checkbox on every row at
            rest turns a library into a form. */}
        <label
          className={`flex flex-shrink-0 cursor-pointer items-center pl-4 pr-1 transition-opacity duration-fast ${
            selected || selectionActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
          title="Select"
          onClick={(e) => {
            // Shift-click needs the event, which the change handler does not
            // carry, so selection is driven from the click instead.
            e.preventDefault();
            onSelect(mod.id, e);
          }}
        >
          <input
            type="checkbox"
            checked={selected}
            readOnly
            aria-label={`Select ${mod.name}`}
            className="h-[15px] w-[15px] cursor-pointer accent-f1red"
          />
        </label>

        {/* Favourite. Sits before the drag handle so the pinned ones are
            scannable down a single column. */}
        <button
          onClick={() => setModFavourite(mod.id, !mod.favourite)}
          className={`flex flex-shrink-0 items-center px-1 transition-colors ${
            mod.favourite
              ? "text-warning"
              : "text-text-muted/40 opacity-0 hover:text-warning group-hover:opacity-100 focus-visible:opacity-100"
          }`}
          title={mod.favourite ? "Remove from favourites" : "Mark as favourite"}
          aria-pressed={mod.favourite}
          aria-label={`${mod.favourite ? "Unpin" : "Pin"} ${mod.name}`}
        >
          <Icon name={mod.favourite ? "star-solid" : "star"} size={15} />
        </button>

        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="flex flex-shrink-0 cursor-grab items-center px-2 text-text-muted transition-colors hover:text-text-secondary active:cursor-grabbing"
          title="Drag to change load order"
          aria-label={`Reorder ${mod.name}`}
        >
          <Icon name="grip" size={16} />
        </button>

        {/* Load order */}
        <div className="flex flex-shrink-0 items-center gap-1 pr-3">
          <span
            className={`flex items-center justify-center rounded-lg border font-mono font-bold ${
              compact ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm"
            } ${
              mod.enabled
                ? "border-f1red/25 bg-f1red/10 text-f1red"
                : "border-border bg-surface-raised text-text-muted"
            }`}
            title={`Load order ${position} — the top of the list overrides the ones below`}
          >
            {position.toString().padStart(2, "0")}
          </span>

          {/* Dragging is fine for a nudge; these are for moving across a long
              list without fighting the scroll. */}
          {/* Nudging up and down is a refinement, not something you need in
              view at rest. Still in the context menu and the palette, so
              nothing becomes unreachable — the row just stops shouting. */}
          {onMove && !compact && (
            <div className="flex flex-col opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-within:opacity-100">
              <button
                onClick={() => onMove(mod.id, "up")}
                disabled={isFirst}
                className="flex h-[18px] w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:pointer-events-none disabled:opacity-25"
                title="Move up"
                aria-label={`Move ${mod.name} up`}
              >
                <Icon name="chevron-up" size={12} strokeWidth={2.4} />
              </button>
              <button
                onClick={() => onMove(mod.id, "down")}
                disabled={isLast}
                className="flex h-[18px] w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:pointer-events-none disabled:opacity-25"
                title="Move down"
                aria-label={`Move ${mod.name} down`}
              >
                <Icon name="chevron-down" size={12} strokeWidth={2.4} />
              </button>
            </div>
          )}
        </div>

        {/* Thumbnail. Dropped in compact mode: at 36px it is a coloured smudge
            that costs a column of names. */}
        {!compact && (
          <div className="flex flex-shrink-0 items-center py-3">
            {/* 64px box, 96px source: `fill` is a downscale here, so it stays
                sharp and there is no need for the blurred treatment. */}
            <ModCover
              src={thumbnail}
              name={mod.name}
              mode="fill"
              className="h-16 w-16 rounded-xl border border-border"
            />
          </div>
        )}

        {/* Info */}
        <button
          onClick={() => setIsDetailsOpen(true)}
          className={`flex min-w-0 flex-1 flex-col justify-center px-4 text-left ${
            compact ? "gap-0 py-1.5" : "gap-1.5 py-3"
          }`}
          title="Open details"
        >
          <div className="flex min-w-0 items-center gap-2">
            {/* The name is what the row is about. It was 15px among a dozen
                12px labels, which is not a hierarchy. */}
            <h3
              className={`truncate font-semibold ${compact ? "text-sm" : "text-lg"} ${
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
            <IntegrityBadge integrity={mod.integrity} />
            {contested.length > 0 &&
              (overriddenBy ? (
                <ConflictBadge
                  chunks={contested}
                  files={standing?.files}
                  certain={standing?.certain}
                  overriddenBy={overriddenBy}
                  overriddenByPosition={standing?.overriddenByPosition}
                />
              ) : (
                <span
                  className="chip flex-shrink-0 border-success/25 bg-success/10 text-success"
                  title={
                    standing?.certain
                      ? `Wins the ${standing.files?.length ?? 0} file${
                          (standing.files?.length ?? 0) === 1 ? "" : "s"
                        } it shares with another mod, because it sits higher in the load order`
                      : `Probably wins pakchunk ${contested.join(", ")} — estimated, the contents could not be read`
                  }
                >
                  Applied
                </span>
              ))}
          </div>

          <div
            className={`flex min-w-0 flex-wrap items-center gap-x-3 text-xs text-text-muted/80 ${
              compact ? "gap-y-0" : "gap-y-1"
            }`}
          >
            {mod.author && <span className="truncate">by {mod.author}</span>}
            {!compact && <span>{mod.sourceUrl ? "Overtake.gg" : "Local file"}</span>}
            {!compact && formatDate(mod.installedAt) && <span>{formatDate(mod.installedAt)}</span>}
            <span className="font-mono">
              {mod.pakFiles.length} file{mod.pakFiles.length === 1 ? "" : "s"}
            </span>
            {mod.sizeBytes > 0 && <span className="font-mono">{formatBytes(mod.sizeBytes)}</span>}
          </div>
        </button>

        {/* Actions */}
        <div className={`flex flex-shrink-0 items-center gap-2 ${compact ? "px-3" : "px-4"}`}>
          {update && onUpdate && (
            <button
              onClick={() => onUpdate(update)}
              className="btn-ghost h-9 !px-3 !text-xs border-f1red/30 text-f1red hover:bg-f1red/10 hover:text-f1red"
              title={`Update to ${update.newVersion}`}
            >
              <Icon name="upload" size={15} />
              {!compact && "Update"}
            </button>
          )}

          <label className="toggle-switch" title={mod.enabled ? "Disable mod" : "Enable mod"}>
            <input
              type="checkbox"
              checked={mod.enabled}
              aria-label={`${mod.enabled ? "Disable" : "Enable"} ${mod.name}`}
              onChange={(e) => onToggle(mod.id, e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>

          <div className="flex overflow-hidden rounded-lg border border-border opacity-0 transition-opacity duration-fast group-hover:opacity-100 focus-within:opacity-100">
            {onOpenFolder && !compact && (
              <button
                onClick={onOpenFolder}
                className="border-r border-border p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
                title="Open ~mods folder"
                aria-label="Open the mods folder"
              >
                <Icon name="folder" size={16} />
              </button>
            )}
            {/* One click, and an Undo in the toast. The old "click twice to
                confirm" made the safe path slower without making the unsafe
                one recoverable. */}
            <button
              onClick={() => onDelete(mod.id)}
              className="p-2 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
              title="Uninstall mod"
              aria-label={`Uninstall ${mod.name}`}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        </div>
      </div>

      {isDetailsOpen && (
        <ModDetailsModal
          mod={mod}
          isOpen
          onClose={() => setIsDetailsOpen(false)}
          update={update}
          onToggle={onToggle}
          onDelete={onDelete}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}

export const ModCard = memo(ModCardBase);
