import { useEffect } from "react";
import { Icon } from "./Icon";

/**
 * Actions for the current selection.
 *
 * Floats over the list rather than sitting in the header, because it only
 * exists while something is selected and a header that grows a row when you
 * tick a box shifts the very list you are ticking.
 */
export function BulkActionBar({
  count,
  onEnable,
  onDisable,
  onUninstall,
  onTop,
  onClear,
}: {
  count: number;
  onEnable: () => void;
  onDisable: () => void;
  onUninstall: () => void;
  onTop: () => void;
  onClear: () => void;
}) {
  // Tells the stylesheet to lift the toasts, which otherwise sit under this
  // bar on a narrow window. An attribute rather than shared state: nothing
  // else needs to know, and it cannot get out of sync with what is rendered.
  useEffect(() => {
    if (count === 0) return;
    document.body.dataset.bulkBar = "1";
    return () => {
      delete document.body.dataset.bulkBar;
    };
  }, [count]);

  if (count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-drawer flex justify-center px-6">
      <div
        role="toolbar"
        aria-label={`Actions for ${count} selected mods`}
        className="pointer-events-auto flex animate-slide-up items-center gap-1 rounded-2xl border border-border-strong bg-surface-raised/95 p-1.5 shadow-elev-3"
      >
        <span className="px-3 text-sm font-medium text-text-primary">
          {count} selected
        </span>

        <span className="mx-1 h-6 w-px bg-border" />

        <button onClick={onEnable} className="btn-subtle !py-1.5 !text-xs">
          <Icon name="check" size={14} />
          Enable
        </button>
        <button onClick={onDisable} className="btn-subtle !py-1.5 !text-xs">
          <Icon name="close" size={14} />
          Disable
        </button>
        <button onClick={onTop} className="btn-subtle !py-1.5 !text-xs" title="Move to the top of the load order">
          <Icon name="chevron-up" size={14} />
          To the top
        </button>
        <button onClick={onUninstall} className="btn-subtle !py-1.5 !text-xs hover:bg-danger/10 hover:text-danger">
          <Icon name="trash" size={14} />
          Uninstall
        </button>

        <span className="mx-1 h-6 w-px bg-border" />

        <button onClick={onClear} className="btn-icon-sm" title="Clear the selection (Esc)" aria-label="Clear selection">
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  );
}
