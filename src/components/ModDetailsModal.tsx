import { useEffect } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { BackgroundBlur } from "./BackgroundBlur";
import { formatDate } from "../lib/format";
import type { Mod } from "../types";

interface ModDetailsModalProps {
  mod: Mod;
  isOpen: boolean;
  onClose: () => void;
}

export function ModDetailsModal({ mod, isOpen, onClose }: ModDetailsModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const cover = mod.imageUrl || mod.thumbnailUrl;

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <BackgroundBlur imageUrl={cover} />

      <div
        className="panel flex max-h-[88vh] w-full max-w-2xl animate-slide-up flex-col overflow-hidden bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-52 flex-shrink-0 border-b border-border bg-bg-elevated">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-muted/30">
              <svg className="h-14 w-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface to-transparent" />

          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
            title="Close"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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
              <span className="chip border-border bg-surface-raised text-text-secondary">v{mod.version}</span>
            )}
            {mod.author && (
              <span className="chip border-border bg-surface-raised text-text-secondary">{mod.author}</span>
            )}
            <span className="chip border-border bg-surface-raised text-text-secondary">
              slot {mod.loadOrder + 1}
            </span>
          </div>

          {mod.description && (
            <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
              {mod.description}
            </p>
          )}

          <dl className="mt-6 grid grid-cols-2 gap-3">
            <Detail label="Installed" value={formatDate(mod.installedAt) || "Unknown"} />
            <Detail label="Source" value={mod.sourceUrl ? "Overtake.gg" : "Local file"} />
            <Detail
              label="Pakchunks"
              value={mod.pakchunks.length ? mod.pakchunks.join(", ") : "None detected"}
            />
            <Detail label="Checksum" value={mod.checksum ? `${mod.checksum.slice(0, 12)}…` : "—"} mono />
          </dl>

          <div className="mt-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
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
              Open mod page
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-text-muted">{label}</dt>
      <dd className={`mt-1 truncate text-sm text-text-primary ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
