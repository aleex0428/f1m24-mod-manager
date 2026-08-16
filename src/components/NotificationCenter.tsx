import { useEffect, useRef, useState } from "react";
import { selectUnreadCount, useModStore } from "../store/modStore";
import { Icon } from "./Icon";
import type { NotificationKind } from "../types";

const KIND_STYLES: Record<NotificationKind, string> = {
  success: "bg-success",
  error: "bg-danger",
  info: "bg-info",
};

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const notifications = useModStore((s) => s.notifications);
  const unreadCount = useModStore(selectUnreadCount);
  const markRead = useModStore((s) => s.markNotificationsRead);
  const clearAll = useModStore((s) => s.clearNotifications);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const toggle = () => {
    setIsOpen((open) => {
      if (!open) markRead();
      return !open;
    });
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        className="btn-icon relative"
        title="Notifications"
        aria-label="Notifications"
      >
        <Icon name="bell" size={18} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-f1red px-1 font-mono text-2xs font-bold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="panel absolute right-0 z-50 mt-2 flex max-h-[26rem] w-80 animate-slide-up flex-col overflow-hidden bg-surface">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h3 className="font-display text-sm font-bold text-text-primary">Activity</h3>
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-text-muted transition-colors hover:text-text-primary"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto" aria-live="polite">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-text-muted">
                <Icon name="inbox" size={32} className="opacity-40" />
                Nothing here yet
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {notifications.map((n) => (
                  <li key={n.id} className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-raised/60">
                    <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${KIND_STYLES[n.kind]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight text-text-primary">{n.title}</p>
                      {n.message && (
                        <p className="mt-0.5 break-words text-xs leading-snug text-text-secondary">
                          {n.message}
                        </p>
                      )}
                      <p className="mt-1 font-mono text-2xs text-text-muted">{timeAgo(n.timestamp)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
