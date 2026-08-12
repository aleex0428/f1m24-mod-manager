import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { changesFor, renderInline } from "../lib/whatsNew";
import { useModStore } from "../store/modStore";

const SEEN_VERSION = "last_seen_version";

const TONE: Record<string, string> = {
  Added: "border-success/25 bg-success/10 text-success",
  Improved: "border-info/25 bg-info/10 text-info",
  Fixed: "border-f1red/25 bg-f1red/10 text-f1red",
};

/**
 * Shown once after the app updates itself, so a silent background update does
 * not just change things under the user with no explanation.
 */
export function WhatsNewModal() {
  const appVersion = useModStore((s) => s.appVersion);
  const [isOpen, setIsOpen] = useState(false);

  const sections = useMemo(() => changesFor(appVersion), [appVersion]);

  useEffect(() => {
    if (!appVersion || sections.length === 0) return;

    let cancelled = false;
    invoke<string>("get_setting", { key: SEEN_VERSION })
      .then((seen) => {
        if (cancelled) return;
        // A first run has nothing to compare against; only an actual change
        // from a previous version is worth interrupting for.
        if (!seen) {
          invoke("save_setting", { key: SEEN_VERSION, value: appVersion }).catch(() => {});
          return;
        }
        if (seen !== appVersion) setIsOpen(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [appVersion, sections.length]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const dismiss = () => {
    setIsOpen(false);
    invoke("save_setting", { key: SEEN_VERSION, value: appVersion }).catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-[105] flex animate-fade-in items-center justify-center bg-black/75 p-4"
      onClick={dismiss}
    >
      <div
        className="panel flex max-h-[82vh] w-full max-w-xl animate-slide-up flex-col bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-f1red to-f1red-dark shadow-f1">
            <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-text-primary">
              Updated to {appVersion}
            </h2>
            <p className="text-xs text-text-muted">Here is what changed.</p>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {sections.map((section) => (
            <section key={section.heading}>
              <span className={`chip ${TONE[section.heading] ?? "border-border bg-surface-raised text-text-secondary"}`}>
                {section.heading}
              </span>
              <ul className="mt-2.5 space-y-2">
                {section.entries.map((entry, index) => (
                  <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                    <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-text-muted" />
                    <span>
                      {renderInline(entry).map((part, i) =>
                        part.bold ? (
                          <strong key={i} className="font-semibold text-text-primary">
                            {part.text}
                          </strong>
                        ) : part.code ? (
                          <code key={i} className="rounded bg-bg-elevated px-1 py-0.5 font-mono text-xs">
                            {part.text}
                          </code>
                        ) : (
                          <span key={i}>{part.text}</span>
                        )
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="border-t border-border px-6 py-4">
          <button onClick={dismiss} className="btn-primary w-full">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
