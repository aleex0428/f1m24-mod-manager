import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";
import type { ConflictInfo } from "../types";

interface PlayButtonProps {
  conflicts: ConflictInfo[];
}

export function PlayButton({ conflicts }: PlayButtonProps) {
  const mods = useModStore((s) => s.mods);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [launching, setLaunching] = useState(false);

  const activeConflicts = useMemo(() => {
    const enabledIds = new Set(mods.filter((m) => m.enabled).map((m) => m.id));
    return conflicts.filter((c) => c.mods.filter((id) => enabledIds.has(id)).length > 1);
  }, [conflicts, mods]);

  const launchGame = useCallback(async () => {
    setLaunching(true);
    try {
      await invoke("launch_game");
      toast.success("Launching F1 Manager 24…");
    } catch (err) {
      toast.error(`Could not launch the game: ${err}`);
    } finally {
      setLaunching(false);
    }
  }, []);

  const handlePlay = () => {
    if (activeConflicts.length > 0) setShowConflictModal(true);
    else launchGame();
  };

  return (
    <>
      <button onClick={handlePlay} disabled={launching} className="btn-primary !px-5">
        {launching ? (
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
        <span className="font-display tracking-wide">{launching ? "LAUNCHING" : "PLAY"}</span>
        {activeConflicts.length > 0 && !launching && (
          <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        )}
      </button>

      {showConflictModal && (
        <div className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/70 p-4">
          <div className="panel w-full max-w-md animate-slide-up bg-surface p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/10">
                <svg className="h-5 w-5 text-warning" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div>
                <h2 className="font-display font-bold text-text-primary">Conflicting mods</h2>
                <p className="text-sm text-text-secondary">
                  {activeConflicts.length} pakchunk{activeConflicts.length > 1 ? "s are" : " is"} claimed
                  by more than one active mod
                </p>
              </div>
            </div>

            <div className="mb-5 max-h-48 space-y-2 overflow-y-auto">
              {activeConflicts.map((c) => (
                <div key={c.pakchunk} className="rounded-xl border border-border-subtle bg-bg-elevated p-3">
                  <p className="mb-1 font-mono text-xs text-warning">pakchunk {c.pakchunk}</p>
                  <p className="text-sm text-text-secondary">{c.modNames.join("  ·  ")}</p>
                </div>
              ))}
            </div>

            <p className="mb-4 text-xs text-text-muted">
              Only the mod highest in the load order will be applied. Disable the others to be safe.
            </p>

            <div className="flex gap-3">
              <button onClick={() => setShowConflictModal(false)} className="btn-ghost flex-1">
                Go back
              </button>
              <button
                onClick={() => {
                  setShowConflictModal(false);
                  launchGame();
                }}
                className="btn-primary flex-1"
              >
                Launch anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
