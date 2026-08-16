import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";
import { Modal } from "./Modal";
import { Icon, Spinner } from "./Icon";
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
      <button
        onClick={handlePlay}
        disabled={launching}
        className="btn-primary !px-5"
        title={
          activeConflicts.length > 0
            ? `${activeConflicts.length} pakchunk conflict${activeConflicts.length > 1 ? "s" : ""} unresolved`
            : "Launch the game"
        }
      >
        {launching ? <Spinner size={16} /> : <Icon name="play" size={16} />}
        <span className="font-display tracking-wide">{launching ? "LAUNCHING" : "PLAY"}</span>
        {activeConflicts.length > 0 && !launching && (
          <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        )}
      </button>

      <Modal
        isOpen={showConflictModal}
        onClose={() => setShowConflictModal(false)}
        title="Conflicting mods"
      >
        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/10 text-warning">
              <Icon name="warning-solid" size={20} />
            </div>
            <div>
              <h2 className="font-display font-bold text-text-primary">Conflicting mods</h2>
              <p className="text-sm text-text-secondary">
                {activeConflicts.length} pakchunk{activeConflicts.length > 1 ? "s are" : " is"}{" "}
                claimed by more than one active mod
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
      </Modal>
    </>
  );
}
