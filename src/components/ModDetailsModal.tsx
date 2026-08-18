import { useEffect, useRef, useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { BackgroundBlur } from "./BackgroundBlur";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { ModCover } from "./ModCover";
import { setModFavourite, setModNotes } from "../lib/modActions";
import { formatBytes, formatDate } from "../lib/format";
import type { Mod, UpdateAvailable } from "../types";

interface ModDetailsModalProps {
  mod: Mod;
  isOpen: boolean;
  onClose: () => void;
  update?: UpdateAvailable;
  onToggle?: (id: string, enabled: boolean) => void;
  onDelete?: (id: string) => void;
  onUpdate?: (update: UpdateAvailable) => void;
}

export function ModDetailsModal({
  mod,
  isOpen,
  onClose,
  update,
  onToggle,
  onDelete,
  onUpdate,
}: ModDetailsModalProps) {
  const cover = mod.imageUrl || mod.thumbnailUrl;

  // Notes are held locally while typing and written when the field loses
  // focus. Saving on every keystroke would rewrite mods.json per character.
  const [draft, setDraft] = useState(mod.notes ?? "");
  const saved = useRef(mod.notes ?? "");

  useEffect(() => {
    setDraft(mod.notes ?? "");
    saved.current = mod.notes ?? "";
  }, [mod.id, mod.notes]);

  const commitNotes = () => {
    if (draft === saved.current) return;
    saved.current = draft;
    setModNotes(mod.id, draft);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mod.name}
      size="max-w-2xl"
      backdrop={<BackgroundBlur imageUrl={cover} />}
    >
      <div className="relative h-52 flex-shrink-0 border-b border-border bg-bg-elevated">
        {/* The worst offender before this change: the same 96px icon stretched
            to 672×208, a seven-fold enlargement. */}
        <ModCover src={cover} name={mod.name} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent" />

        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
          title="Close"
          aria-label="Close"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="font-display text-2xl font-bold text-text-primary">{mod.name}</h2>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`chip ${
              mod.enabled
                ? "border-success/25 bg-success/10 text-success"
                : "border-border bg-surface-raised text-text-muted"
            }`}
          >
            {mod.enabled ? "Active" : "Disabled"}
          </span>
          {mod.version && (
            <span className="chip border-border bg-surface-raised text-text-secondary">
              v{mod.version}
            </span>
          )}
          {mod.author && (
            <span className="chip border-border bg-surface-raised text-text-secondary">
              {mod.author}
            </span>
          )}
          <span className="chip border-border bg-surface-raised text-text-secondary">
            slot {mod.loadOrder + 1}
          </span>

          <button
            onClick={() => setModFavourite(mod.id, !mod.favourite)}
            aria-pressed={mod.favourite}
            className={`chip transition-colors ${
              mod.favourite
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-border bg-surface-raised text-text-muted hover:text-text-secondary"
            }`}
          >
            <Icon name={mod.favourite ? "star-solid" : "star"} size={12} />
            {mod.favourite ? "Favourite" : "Add to favourites"}
          </button>
        </div>

        {mod.description && (
          <p className="selectable mt-5 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
            {mod.description}
          </p>
        )}

        <dl className="mt-6 grid grid-cols-2 gap-3">
          <Detail label="Installed" value={formatDate(mod.installedAt) || "Unknown"} />
          <Detail label="Size on disk" value={mod.sizeBytes > 0 ? formatBytes(mod.sizeBytes) : "—"} />
          <Detail
            label="Pakchunks"
            value={mod.pakchunks.length ? mod.pakchunks.join(", ") : "None detected"}
          />
          <Detail label="Checksum" value={mod.checksum ? `${mod.checksum.slice(0, 12)}…` : "—"} mono />
        </dl>

        <div className="mt-6">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
            Your notes
          </h3>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitNotes}
            rows={3}
            placeholder="Why is this disabled? What did it clash with? Anything you will want to remember."
            aria-label="Your notes about this mod"
            className="input resize-y !py-2 text-sm"
          />
        </div>

        <div className="mt-6">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
            Installed files
          </h3>
          <div className="flex flex-col gap-1.5">
            {mod.pakFiles.map((pak) => (
              <span
                key={pak}
                className="truncate rounded-lg border border-border-subtle bg-bg-elevated px-3 py-1.5 font-mono text-xs text-text-secondary"
                title={pak}
              >
                {pak}
              </span>
            ))}
          </div>
        </div>

        {mod.sourceUrl && (
          <button
            onClick={() => shellOpen(mod.sourceUrl!).catch(() => {})}
            className="btn-ghost mt-6 !py-2 !text-xs"
          >
            <Icon name="external" size={14} />
            Open mod page
          </button>
        )}
      </div>

      {/* Acting on what you are looking at, instead of closing this and
          hunting for the row again. */}
      {(onToggle || onDelete) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-4">
          {onToggle && (
            <label className="flex cursor-pointer items-center gap-2.5">
              <span className="toggle-switch">
                <input
                  type="checkbox"
                  checked={mod.enabled}
                  aria-label={`${mod.enabled ? "Disable" : "Enable"} ${mod.name}`}
                  onChange={(e) => onToggle(mod.id, e.target.checked)}
                />
                <span className="toggle-slider" />
              </span>
              <span className="text-sm text-text-secondary">
                {mod.enabled ? "Active" : "Disabled"}
              </span>
            </label>
          )}

          <div className="ml-auto flex items-center gap-2">
            {update && onUpdate && (
              <button
                onClick={() => {
                  onUpdate(update);
                  onClose();
                }}
                className="btn-primary !py-2 !text-xs"
              >
                <Icon name="upload" size={14} />
                Update to {update.newVersion}
              </button>
            )}

            {onDelete && (
              <button
                onClick={() => {
                  onDelete(mod.id);
                  onClose();
                }}
                className="btn-danger !py-2 !text-xs"
                title="Removed files can be restored from the toast"
              >
                <Icon name="trash" size={14} />
                Uninstall
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated px-4 py-3">
      <dt className="text-2xs uppercase tracking-wider text-text-muted">{label}</dt>
      <dd className={`mt-1 truncate text-sm text-text-primary ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
