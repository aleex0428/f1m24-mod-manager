import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface Notice {
  id: string;
  tone: "danger" | "warning" | "accent" | "info";
  icon: IconName;
  message: ReactNode;
  actions?: { label: string; onClick: () => void; disabled?: boolean; title?: string }[];
}

const TONES = {
  danger: { bar: "border-danger/20 bg-danger/10", text: "text-danger", button: "border-danger/30 text-danger" },
  warning: { bar: "border-warning/20 bg-warning/10", text: "text-warning", button: "border-warning/30 text-warning" },
  accent: { bar: "border-f1red/20 bg-f1red/10", text: "text-f1red", button: "border-f1red/30 text-f1red" },
  info: { bar: "border-info/20 bg-info/10", text: "text-info", button: "border-info/30 text-info" },
} as const;

/**
 * One strip for everything the app wants to tell you.
 *
 * Each notice was added on its own and looked reasonable on its own; together
 * they could stack twelve deep and leave a 600px-tall window with no room for
 * the actual list. They share a row now, and collapse to a count once there is
 * more than one.
 *
 * Deliberately *not* here: anything that explains why a control is disabled.
 * Those keep their own row, because a greyed-out button whose reason is folded
 * away behind a chevron is just a broken button.
 */
export function NoticeCentre({ notices }: { notices: Notice[] }) {
  const [expanded, setExpanded] = useState(false);

  if (notices.length === 0) return null;

  // A single notice has nothing to collapse into — showing it costs the same
  // row as the summary would, and saying it outright is friendlier.
  if (notices.length === 1) return <NoticeRow notice={notices[0]} />;

  // Worst tone wins the summary: the point of the count is to convey how bad
  // things are before you open it.
  const worst =
    notices.find((n) => n.tone === "danger") ??
    notices.find((n) => n.tone === "warning") ??
    notices[0];
  const tone = TONES[worst.tone];

  return (
    <div className={`flex-shrink-0 border-b ${tone.bar}`}>
      <button
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-6 py-2 text-left text-xs transition-colors hover:bg-white/[0.03]"
      >
        <Icon name="warning-solid" size={16} className={tone.text} />
        <span className={`flex-1 font-medium ${tone.text}`}>
          {notices.length} things need your attention
        </span>
        <span className={`flex items-center gap-1 text-2xs ${tone.text}`}>
          {expanded ? "Hide" : "Show"}
          <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} />
        </span>
      </button>

      {expanded && (
        <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          {notices.map((notice) => (
            <NoticeRow key={notice.id} notice={notice} nested />
          ))}
        </div>
      )}
    </div>
  );
}

function NoticeRow({ notice, nested }: { notice: Notice; nested?: boolean }) {
  const tone = TONES[notice.tone];

  return (
    <div
      className={`flex flex-shrink-0 flex-wrap items-center gap-3 px-6 py-2 ${
        nested ? "" : `border-b ${tone.bar}`
      }`}
    >
      <Icon name={notice.icon} size={16} className={tone.text} />
      <span className={`min-w-0 flex-1 text-xs ${nested ? "text-text-secondary" : tone.text}`}>
        {notice.message}
      </span>
      {notice.actions?.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.title}
          className={`btn-ghost !py-1 !text-xs ${tone.button}`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
