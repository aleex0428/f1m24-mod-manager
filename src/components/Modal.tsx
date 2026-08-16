import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * The one dialog primitive.
 *
 * Every modal in the app used to reimplement its own Escape handler and its
 * own backdrop, and none of them did the parts that only matter to someone
 * navigating by keyboard: a dialog that is not announced as a dialog, that
 * lets Tab walk out into the page behind it, and that drops focus on the floor
 * when it closes. All of that lives here now.
 *
 *  - `role="dialog"` + `aria-modal` + a label, so it is announced as one.
 *  - Focus moves inside on open and is *restored* to whatever opened it.
 *  - Tab and Shift+Tab cycle within the dialog.
 *  - Escape and a backdrop click close it, unless `dismissable` says otherwise
 *    — the variant picker owns a parked install and must be answered.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible name. Rendered visually only if `titleVisible` is set. */
  title: string;
  children: ReactNode;
  /** Tailwind max-width class for the panel. */
  size?: string;
  /** Escape and backdrop clicks close the dialog. Default true. */
  dismissable?: boolean;
  /** Extra classes for the panel itself. */
  className?: string;
  /** Rendered behind the panel, inside the backdrop (the colour wash). */
  backdrop?: ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "max-w-md",
  dismissable = true,
  className = "",
  backdrop,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const labelId = useId();

  const close = useCallback(() => {
    if (dismissable) onClose();
  }, [dismissable, onClose]);

  // Remember what had focus, move focus in, and put it back on close.
  useEffect(() => {
    if (!isOpen) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    return () => {
      // The opener can be gone by now (a row removed by the very action the
      // dialog performed), so this is best-effort.
      restoreRef.current?.focus?.({ preventScroll: true });
    };
  }, [isOpen]);

  // Escape to close, Tab kept inside.
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }

      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex animate-fade-in items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        // Only a click that both starts and ends on the backdrop closes it,
        // so releasing a text selection outside the panel does not.
        if (e.target === e.currentTarget) close();
      }}
    >
      {backdrop}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        tabIndex={-1}
        className={`panel flex max-h-[88vh] w-full ${size} animate-slide-up flex-col overflow-hidden bg-surface shadow-elev-3 outline-none ${className}`}
      >
        <span id={labelId} className="sr-only">
          {title}
        </span>
        {children}
      </div>
    </div>
  );
}

/** Standard dialog header with a title and a close button. */
export function ModalHeader({
  title,
  description,
  onClose,
  icon,
}: {
  title: string;
  description?: string;
  onClose?: () => void;
  icon?: ReactNode;
}) {
  return (
    <header className="flex flex-shrink-0 items-start gap-3 border-b border-border px-6 py-4">
      {icon}
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-md font-bold text-text-primary">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
      </div>
      {onClose && (
        <button onClick={onClose} className="btn-icon-sm -mr-1" aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      )}
    </header>
  );
}

