import { useEffect, useState } from "react";

interface InstallFromUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (url: string) => void;
}

/**
 * Escape hatch for mods the local catalogue does not know about — because it
 * has not been synced, or because the mod lives outside the F1 Manager 2024
 * category the scraper walks.
 */
export function InstallFromUrlModal({ isOpen, onClose, onSubmit }: InstallFromUrlModalProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setUrl("");
      setError("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError("That does not look like a link.");
      return;
    }

    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || !(host === "overtake.gg" || host.endsWith(".overtake.gg"))) {
      setError("Only https://overtake.gg mod pages can be installed.");
      return;
    }
    if (!/\/downloads\//i.test(parsed.pathname)) {
      setError("Paste the mod's page link, not a forum thread or profile.");
      return;
    }

    onSubmit(parsed.toString());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-lg animate-slide-up bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-text-primary">Install from a link</h2>
        <p className="mb-4 mt-1 text-sm text-text-muted">
          Paste the address of any Overtake.gg mod page. Useful when the mod is newer than your last
          catalogue sync.
        </p>

        <input
          autoFocus
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="https://www.overtake.gg/downloads/my-mod.12345/"
          className="input font-mono !text-xs"
          spellCheck={false}
        />

        {error ? (
          <p className="mt-2 text-xs text-danger">{error}</p>
        ) : (
          <p className="mt-2 text-xs text-text-muted">
            The mod's real name and version are filled in from the catalogue once it installs.
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1">
            Cancel
          </button>
          <button onClick={submit} disabled={!url.trim()} className="btn-primary flex-1">
            Add to queue
          </button>
        </div>
      </div>
    </div>
  );
}
