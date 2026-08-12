import { linkOvertakeAccount } from "../lib/auth";

interface SessionWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SessionWarningModal({ isOpen, onClose }: SessionWarningModalProps) {
  if (!isOpen) return null;

  const handleContinue = async () => {
    await linkOvertakeAccount();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/70 p-4">
      <div className="panel w-full max-w-md animate-slide-up overflow-hidden bg-surface">
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-f1red/30 bg-f1red/10">
            <svg className="h-7 w-7 text-f1red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
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
      </div>
    </div>
  );
}
