import { memo, useState, type MouseEvent } from "react";
import { Icon } from "./Icon";
import { ModCover } from "./ModCover";
import { IntegrityBadge } from "./IntegrityBadge";
import { ModDetailsModal } from "./ModDetailsModal";
import { formatBytes } from "../lib/format";
import type { ConflictStanding, Mod, UpdateAvailable } from "../types";

interface ModTileProps {
  mod: Mod;
  standing?: ConflictStanding;
  update?: UpdateAvailable;
  position: number;
  index: number;
  selected: boolean;
  selectionActive: boolean;
  onSelect: (id: string, event: MouseEvent) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate?: (update: UpdateAvailable) => void;
  onContextMenu?: (event: MouseEvent, mod: Mod) => void;
}

/**
 * The library's grid card.
 *
 * Mods are pictures of cars, and the list view shows them at 64px. This is the
 * view for recognising a livery rather than reading a filename. Load order is
 * still on the card — it decides what the game does — but reordering stays a
 * list-view gesture: dragging tiles around a reflowing grid says nothing about
 * a linear priority.
 */
function ModTileBase({
  mod,
  standing,
  update,
  position,
  index,
  selected,
  selectionActive,
  onSelect,
  onToggle,
  onDelete,
  onUpdate,
  onContextMenu,
}: ModTileProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const cover = mod.imageUrl || mod.thumbnailUrl;
  const overriddenBy = standing?.overriddenBy;

  return (
    <>
      <article
        style={{ "--i": index } as React.CSSProperties}
        data-row-id={mod.id}
        onContextMenu={(e) => onContextMenu?.(e, mod)}
        className={`stagger cv-auto-tile group relative flex flex-col overflow-hidden rounded-2xl border bg-surface/60 shadow-elev-1 transition-colors duration-base ${
          selected
            ? "border-f1red/60 bg-f1red/[0.07]"
            : mod.enabled
              ? "border-border hover:border-f1red/40"
              : "border-border-subtle opacity-70 hover:opacity-100"
        }`}
      >
        <button
          onClick={() => setIsDetailsOpen(true)}
          className="relative block aspect-[16/9] w-full overflow-hidden bg-bg-elevated text-left"
          title={`${mod.name} — open details`}
        >
          <ModCover
            src={cover}
            name={mod.name}
            reactive
            className="absolute inset-0 h-full w-full"
          />

          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg/95 to-transparent" />

          {/* Load-order slot */}
          <span
            className={`absolute left-2.5 top-2.5 flex h-7 min-w-7 items-center justify-center rounded-lg border px-1.5 font-mono text-xs font-bold backdrop-blur-sm ${
              mod.enabled
                ? "border-f1red/40 bg-f1red/25 text-white"
                : "border-border-strong bg-black/50 text-text-muted"
            }`}
            title={`Load order ${position}`}
          >
            {position.toString().padStart(2, "0")}
          </span>

          {!mod.enabled && (
            <span className="absolute right-2.5 top-2.5 rounded-lg bg-black/65 px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-text-secondary">
              Disabled
            </span>
          )}
          {mod.enabled && overriddenBy && !update && (
            <span className="absolute right-2.5 top-2.5 rounded-lg bg-warning/85 px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-black">
              No effect
            </span>
          )}
          {update && (
            <span className="absolute right-2.5 top-2.5 rounded-lg bg-f1red px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-white">
              Update
            </span>
          )}
        </button>

        {/* Selection sits above the cover so it is reachable without opening
            the details panel. */}
        <label
          className={`absolute left-2.5 top-2.5 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-black/65 transition-opacity duration-fast ${
            selected || selectionActive
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
          onClick={(e) => {
            e.preventDefault();
            onSelect(mod.id, e);
          }}
          title="Select"
        >
          <input
            type="checkbox"
            checked={selected}
            readOnly
            aria-label={`Select ${mod.name}`}
            className="h-[15px] w-[15px] cursor-pointer accent-f1red"
          />
        </label>

        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
          <h3
            className="truncate text-sm font-semibold text-text-primary"
            title={mod.name}
          >
            {mod.name}
          </h3>

          <p className="truncate text-2xs text-text-muted">
            {mod.author ? `by ${mod.author}` : mod.sourceUrl ? "Overtake.gg" : "Local file"}
            {mod.sizeBytes > 0 && ` · ${formatBytes(mod.sizeBytes)}`}
          </p>

          {mod.integrity !== "ok" && (
            <span className="flex">
              <IntegrityBadge integrity={mod.integrity} />
            </span>
          )}

          {overriddenBy && (
            <p
              className="flex items-center gap-1 truncate text-2xs text-warning"
              title={`Enabled, but covered by "${overriddenBy}" — no effect in game`}
            >
              {standing?.overriddenByPosition !== undefined && (
                <span className="font-mono">
                  ↑ {standing.overriddenByPosition.toString().padStart(2, "0")}
                </span>
              )}
              <span className="truncate">covered by {overriddenBy}</span>
            </p>
          )}

          <div className="mt-auto flex items-center gap-2 pt-2">
            <label
              className="toggle-switch"
              title={mod.enabled ? "Disable mod" : "Enable mod"}
            >
              <input
                type="checkbox"
                checked={mod.enabled}
                aria-label={`${mod.enabled ? "Disable" : "Enable"} ${mod.name}`}
                onChange={(e) => onToggle(mod.id, e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>

            <span className="flex-1" />

            {update && onUpdate && (
              <button
                onClick={() => onUpdate(update)}
                className="btn-icon-sm text-f1red hover:bg-f1red/10 hover:text-f1red"
                title={`Update to ${update.newVersion}`}
                aria-label={`Update ${mod.name}`}
              >
                <Icon name="upload" size={15} />
              </button>
            )}

            <button
              onClick={() => onDelete(mod.id)}
              className="btn-icon-sm hover:bg-danger/10 hover:text-danger"
              title="Uninstall mod"
              aria-label={`Uninstall ${mod.name}`}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>
      </article>

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

export const ModTile = memo(ModTileBase);
