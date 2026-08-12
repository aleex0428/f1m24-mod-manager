import { useState } from "react";

export interface InstallPromptModalProps {
  isOpen: boolean;
  url: string | null;
  onClose: () => void;
  onConfirm: (url: string) => Promise<void> | void;
}

export function InstallPromptModal({ isOpen, url, onClose, onConfirm }: InstallPromptModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !url) return null;

  const handleConfirm = async () => {
    try {
      setIsSubmitting(true);
      await onConfirm(url);
      onClose();
    } catch {
      // Errors are surfaced by the caller via toast.
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-md animate-slide-up overflow-hidden bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1 w-full bg-gradient-to-r from-f1red-dark via-f1red to-f1red-light" />

        <div className="flex flex-col items-center p-6 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-f1red/30 bg-f1red/10 text-f1red">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </div>

          <h3 className="font-display text-xl font-bold text-text-primary">Install this mod?</h3>
          <p className="mb-5 mt-2 text-sm text-text-secondary">
            It will be downloaded from Overtake.gg and installed into your ~mods folder.
          </p>

          <div className="mb-6 w-full rounded-xl border border-border bg-bg-elevated p-3 text-left">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Mod page
            </div>
            <div className="select-all truncate font-mono text-xs text-f1red-light" title={url}>
              {url}
            </div>
          </div>

          <div className="flex w-full items-center gap-3">
            <button onClick={onClose} disabled={isSubmitting} className="btn-ghost flex-1">
              Cancel
            </button>
            <button onClick={handleConfirm} disabled={isSubmitting} className="btn-primary flex-1">
              {isSubmitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Adding…
                </>
              ) : (
                "Download"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default InstallPromptModal;
