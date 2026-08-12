import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tauriHandle } from "../lib/tauri";

/**
 * Minimise / maximise / close, drawn inside the app header now that the system
 * frame is gone. Dragging and double-click-to-maximise are handled by the
 * `data-tauri-drag-region` attribute on the header itself.
 */
export function WindowControls() {
  // Resolved lazily and defensively: this is chrome, and a failure here must
  // never take the whole interface down with it.
  const [appWindow, setAppWindow] = useState<ReturnType<typeof getCurrentWindow> | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    setAppWindow(tauriHandle(getCurrentWindow));
  }, []);

  useEffect(() => {
    if (!appWindow) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    const sync = () => appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    sync();

    appWindow
      .onResized(sync)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow]);

  if (!appWindow) return null;

  const win = () => appWindow;


  return (
    <div className="no-drag ml-1 flex items-center">
      <button
        onClick={() => win().minimize().catch(() => {})}
        className="flex h-9 w-11 items-center justify-center text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
        title="Minimise"
        aria-label="Minimise"
      >
        <svg className="h-[10px] w-[10px]" viewBox="0 0 10 10" fill="none" stroke="currentColor">
          <path d="M0 5h10" strokeWidth={1.2} />
        </svg>
      </button>

      <button
        onClick={() => win().toggleMaximize().catch(() => {})}
        className="flex h-9 w-11 items-center justify-center text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
        title={isMaximized ? "Restore" : "Maximise"}
        aria-label={isMaximized ? "Restore" : "Maximise"}
      >
        {isMaximized ? (
          <svg className="h-[10px] w-[10px]" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <path d="M2.5 2.5V0.6h6.9v6.9H7.5" strokeWidth={1.1} />
            <rect x="0.6" y="2.5" width="6.9" height="6.9" strokeWidth={1.1} />
          </svg>
        ) : (
          <svg className="h-[10px] w-[10px]" viewBox="0 0 10 10" fill="none" stroke="currentColor">
            <rect x="0.6" y="0.6" width="8.8" height="8.8" strokeWidth={1.1} />
          </svg>
        )}
      </button>

      <button
        onClick={() => win().close().catch(() => {})}
        className="flex h-9 w-11 items-center justify-center text-text-muted transition-colors hover:bg-danger hover:text-white"
        title="Close"
        aria-label="Close"
      >
        <svg className="h-[10px] w-[10px]" viewBox="0 0 10 10" fill="none" stroke="currentColor">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" strokeWidth={1.2} />
        </svg>
      </button>
    </div>
  );
}
