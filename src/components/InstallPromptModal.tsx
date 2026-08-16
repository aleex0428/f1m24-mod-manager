import { useState } from "react";
import { Modal } from "./Modal";
import { Icon, Spinner } from "./Icon";

export interface InstallPromptModalProps {
  isOpen: boolean;
  url: string | null;
  onClose: () => void;
  onConfirm: (url: string) => Promise<void> | void;
}

export function InstallPromptModal({ isOpen, url, onClose, onConfirm }: InstallPromptModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!url) return;
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
    <Modal isOpen={isOpen && Boolean(url)} onClose={onClose} title="Install this mod?">
      <div className="h-1 w-full flex-shrink-0 bg-gradient-to-r from-f1red-dark via-f1red to-f1red-light" />

      <div className="flex flex-col items-center p-6 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-f1red/30 bg-f1red/10 text-f1red">
          <Icon name="download" size={28} />
        </div>

        <h3 className="font-display text-xl font-bold text-text-primary">Install this mod?</h3>
        <p className="mb-5 mt-2 text-sm text-text-secondary">
          It will be downloaded from Overtake.gg and installed into your ~mods folder.
        </p>

        <div className="mb-6 w-full rounded-xl border border-border bg-bg-elevated p-3 text-left">
          <div className="mb-1 text-2xs font-bold uppercase tracking-wider text-text-muted">
            Mod page
          </div>
          <div className="select-all truncate font-mono text-xs text-f1red-light" title={url ?? ""}>
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
                <Spinner size={16} />
                Adding…
              </>
            ) : (
              "Download"
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default InstallPromptModal;
