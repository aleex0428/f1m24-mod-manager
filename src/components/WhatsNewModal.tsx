import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { changesFor, renderInline } from "../lib/whatsNew";
import { useModStore } from "../store/modStore";
import { Modal } from "./Modal";
import { Icon } from "./Icon";

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

  const dismiss = useCallback(() => {
    setIsOpen(false);
    invoke("save_setting", { key: SEEN_VERSION, value: appVersion }).catch(() => {});
  }, [appVersion]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={dismiss}
      title={`Updated to ${appVersion}`}
      size="max-w-xl"
      className="max-h-[82vh]"
    >
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-6 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-f1red to-f1red-dark text-white shadow-f1">
          <Icon name="bolt" size={16} />
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
            <span
              className={`chip ${
                TONE[section.heading] ?? "border-border bg-surface-raised text-text-secondary"
              }`}
            >
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

      <div className="flex-shrink-0 border-t border-border px-6 py-4">
        <button onClick={dismiss} className="btn-primary w-full">
          Got it
        </button>
      </div>
    </Modal>
  );
}
