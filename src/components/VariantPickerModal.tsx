import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";
import { Modal } from "./Modal";

/** Variant id meaning "take every folder", offered as the last option. */
const INSTALL_ALL = "*";

/**
 * Archives often ship alternatives as sibling folders — "COLORED VERSION" /
 * "WHITE VERSION", one per livery. Installing all of them at once leaves the
 * game with several mods fighting over the same thing, so the install stops
 * here rather than guessing. Occasionally the folders are parts of one mod
 * instead, which is why "install everything" is always on offer.
 *
 * Deliberately not dismissable: this dialog owns a parked extraction and the
 * download slot behind it, so it has to be answered — cancelling is a button,
 * because it has cleanup to do.
 */
export function VariantPickerModal() {
  const pending = useModStore((s) => s.pendingVariant);
  const setPending = useModStore((s) => s.setPendingVariant);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(pending?.variants[0]?.id ?? null);
    setBusy(false);
  }, [pending]);

  const cancel = useCallback(async () => {
    if (!pending) return;
    const { stagingId } = pending;
    setPending(null);
    // Releases the staging folder and the download slot behind it.
    await invoke("cancel_pending_install", { stagingId }).catch(() => {});
  }, [pending, setPending]);

  if (!pending) return null;

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await invoke<string>("resolve_install_variant", {
        stagingId: pending.stagingId,
        variant: selected,
      });
      toast.success("Mod installed");
      setPending(null);
    } catch (err) {
      toast.error(String(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={cancel}
      dismissable={false}
      title="Choose a version"
      size="max-w-lg"
      className="max-h-[85vh]"
    >
      <div className="flex-shrink-0 border-b border-border px-6 py-4">
        <h2 className="font-display text-lg font-bold text-text-primary">Choose a version</h2>
        <p className="mt-1 text-sm text-text-muted">
          <span className="text-text-secondary">{pending.title}</span> contains several folders.
          These are usually alternative versions of the same mod — pick the one you want.
        </p>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4" role="radiogroup" aria-label="Available versions">
        {pending.variants.map((variant) => {
          const isSelected = selected === variant.id;
          const isAll = variant.id === INSTALL_ALL;
          return (
            <button
              key={variant.id}
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(variant.id)}
              className={`w-full rounded-xl border p-3 text-left transition-colors duration-fast ${
                isAll ? "mt-3 border-dashed" : ""
              } ${
                isSelected
                  ? "border-f1red/50 bg-f1red/10"
                  : "border-border bg-bg-elevated hover:border-border-strong"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                    isSelected ? "border-f1red bg-f1red" : "border-border-strong"
                  }`}
                >
                  {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="truncate text-sm font-medium text-text-primary">
                  {variant.label}
                </span>
                {isAll && (
                  <span className="ml-auto flex-shrink-0 text-2xs text-text-muted">
                    only if they are parts of one mod
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5 pl-6.5">
                {variant.files.map((file) => (
                  <span
                    key={file}
                    className="rounded-md border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-2xs text-text-muted"
                  >
                    {file}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-shrink-0 gap-3 border-t border-border px-6 py-4">
        <button onClick={cancel} disabled={busy} className="btn-ghost flex-1">
          Cancel install
        </button>
        <button onClick={confirm} disabled={busy || !selected} className="btn-primary flex-1">
          {busy ? "Installing…" : "Install this one"}
        </button>
      </div>
    </Modal>
  );
}
