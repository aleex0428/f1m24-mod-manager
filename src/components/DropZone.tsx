import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { installLocalFiles, isInstallable } from "../lib/install";
import { tauriHandle } from "../lib/tauri";
import { useModStore } from "../store/modStore";

/**
 * Dropping an archive on the window installs it — the gesture people try first
 * in a mod manager. The overlay only appears while something is being dragged.
 */
export function DropZone() {
  const [state, setState] = useState<"idle" | "valid" | "invalid">("idle");
  const gamePathValid = useModStore((s) => s.gamePathValid);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const webview = tauriHandle(getCurrentWebview);
    if (!webview) return;

    webview
      .onDragDropEvent((event) => {
        const payload = event.payload;

        if (payload.type === "over") {
          setState((current) => (current === "idle" ? "valid" : current));
          return;
        }

        if (payload.type === "drop") {
          setState("idle");
          const paths = payload.paths ?? [];
          if (paths.length > 0) installLocalFiles(paths);
          return;
        }

        setState("idle");
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri runtime: dropping is simply unavailable.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (state === "idle") return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] flex animate-fade-in items-center justify-center bg-bg/85 p-8">
      <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-f1red/60 bg-surface/80 px-16 py-14 text-center shadow-f1-strong">
        <svg className="h-14 w-14 text-f1red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        <div>
          <p className="font-display text-xl font-bold text-text-primary">Drop to install</p>
          <p className="mt-1 text-sm text-text-muted">
            {gamePathValid
              ? ".zip, .rar, .7z or .pak"
              : "Set the game folder in Settings first"}
          </p>
        </div>
      </div>
    </div>
  );
}

export { isInstallable };
