import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { installLocalFiles, isInstallable } from "../lib/install";
import { tauriHandle } from "../lib/tauri";
import { useModStore } from "../store/modStore";
import { Icon } from "./Icon";

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
    <div className="pointer-events-none fixed inset-0 z-dropzone flex animate-fade-in items-center justify-center bg-bg/85 p-8">
      <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-f1red/60 bg-surface/80 px-16 py-14 text-center shadow-f1-strong">
        <Icon name="download" size={56} className="text-f1red" />
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
