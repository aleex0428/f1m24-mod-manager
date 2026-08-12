import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";

/**
 * Some archives ship several interchangeable copies of the same mod — an
 * "Option A" / "Option B" pair, or one folder per livery. They share file
 * names, so installing them all would silently overwrite one with another.
 * The install stops here instead of picking for the user.
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

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;

  const cancel = async () => {
    const { stagingId } = pending;
    setPending(null);
    // Releases the staging folder and the download slot behind it.
    await invoke("cancel_pending_install", { stagingId }).catch(() => {});
  };

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
    <div className="fixed inset-0 z-[110] flex animate-fade-in items-center justify-center bg-black/75 p-4">
      <div className="panel flex max-h-[85vh] w-full max-w-lg animate-slide-up flex-col bg-surface">
        <div className="border-b border-border px-6 py-4">
          <h2 className="font-display text-lg font-bold text-text-primary">Choose a version</h2>
          <p className="mt-1 text-sm text-text-muted">
            <span className="text-text-secondary">{pending.title}</span> contains several versions
            that use the same file names, so only one can be installed.
          </p>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {pending.variants.map((variant) => {
            const isSelected = selected === variant.id;
            return (
              <button
                key={variant.id}
                onClick={() => setSelected(variant.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
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
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5 pl-6.5">
                  {variant.files.map((file) => (
                    <span
                      key={file}
                      className="rounded-md border border-border-subtle bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
                    >
                      {file}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button onClick={cancel} disabled={busy} className="btn-ghost flex-1">
            Cancel install
          </button>
          <button onClick={confirm} disabled={busy || !selected} className="btn-primary flex-1">
            {busy ? "Installing…" : "Install this one"}
          </button>
        </div>
      </div>
    </div>
  );
}
