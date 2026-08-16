import { linkOvertakeAccount } from "../lib/auth";
import { Modal } from "./Modal";
import { Icon } from "./Icon";

interface SessionWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SessionWarningModal({ isOpen, onClose }: SessionWarningModalProps) {
  const handleContinue = async () => {
    await linkOvertakeAccount();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sign-in required">
      <div className="p-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-f1red/30 bg-f1red/10 text-f1red">
          <Icon name="lock" size={28} />
        </div>

        <h2 className="font-display text-xl font-bold text-text-primary">Sign-in required</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Overtake.gg needs you to sign in before this file can be downloaded. The queue resumes on
          its own once you are back in.
        </p>
        <p className="mb-6 mt-3 rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-text-muted">
          Tick <span className="text-text-secondary">“Stay signed in”</span> on the Overtake form so
          the session survives restarts.
        </p>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1">
            Later
          </button>
          <button onClick={handleContinue} className="btn-primary flex-1">
            Sign in
          </button>
        </div>
      </div>
    </Modal>
  );
}
