import { useEffect, useRef, useState } from "react";
import { selectUnreadCount, useModStore } from "../store/modStore";
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
        className="btn-subtle relative h-9 w-9 !px-0"
        title="Notifications"
        aria-label="Notifications"
      >
        <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.6}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-f1red px-1 font-mono text-[9px] font-bold text-white">
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

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-text-muted">
                <svg className="h-8 w-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
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
                      <p className="mt-1 font-mono text-[10px] text-text-muted">{timeAgo(n.timestamp)}</p>
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
