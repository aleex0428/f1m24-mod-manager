import { Icon, type IconName } from "./Icon";
import { usePreference } from "../hooks/usePreference";
import { AnimatedNumber } from "./AnimatedNumber";
import { formatBytes } from "../lib/format";
import type { LibraryFilter } from "../pages/Library";

interface SummaryProps {
  total: number;
  active: number;
  diskBytes: number;
  conflicts: number;
  updates: number;
  checkingUpdates: boolean;
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
  onCheckUpdates: () => void;
}

/**
 * The four numbers worth knowing before you touch anything, above the list.
 *
 * Each one is also the way to act on it: the conflicts tile filters down to
 * the mods that are fighting, the updates tile either filters or starts the
 * check. A statistic you cannot act on is decoration, and this app already had
 * enough of those buried in a subtitle line.
 */
export function LibrarySummary({
  total,
  active,
  diskBytes,
  conflicts,
  updates,
  checkingUpdates,
  filter,
  onFilter,
  onCheckUpdates,
}: SummaryProps) {
  // Four tiles is a lot of vertical space to spend permanently on numbers you
  // mostly glance at once. Collapsed, the same figures survive as one line.
  const [collapsed, setCollapsed] = usePreference("library-summary-collapsed", false);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="pressable flex flex-shrink-0 items-center gap-3 border-b border-border/70 px-6 py-1.5 text-left text-2xs text-text-muted hover:bg-surface/40"
        aria-expanded={false}
      >
        <span className="font-mono text-text-secondary">
          {active}/{total}
        </span>
        <span>active</span>
        {diskBytes > 0 && <span className="font-mono">{formatBytes(diskBytes)}</span>}
        {conflicts > 0 && <span className="text-warning">{conflicts} conflicts</span>}
        {updates > 0 && <span className="text-f1red">{updates} updates</span>}
        <Icon name="chevron-down" size={13} className="ml-auto" />
      </button>
    );
  }

  return (
    <div className="relative grid flex-shrink-0 grid-cols-2 gap-2 border-b border-border/70 px-6 py-3 lg:grid-cols-4">
      <button
        onClick={() => setCollapsed(true)}
        className="absolute right-1.5 top-1.5 rounded p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
        title="Collapse the summary"
        aria-label="Collapse the summary"
        aria-expanded
      >
        <Icon name="chevron-up" size={13} />
      </button>
      <Tile
        icon="power"
        label="Active"
        tone={active > 0 ? "accent" : "muted"}
        selected={filter === "active"}
        onClick={() => onFilter(filter === "active" ? "all" : "active")}
        value={
          <>
            <AnimatedNumber value={active} />
            <span className="text-sm font-normal text-text-muted"> / {total}</span>
          </>
        }
        hint={total === 0 ? "Nothing installed" : `${total - active} disabled`}
      />

      <Tile
        icon="disk"
        label="On disk"
        tone="muted"
        value={diskBytes > 0 ? formatBytes(diskBytes) : "—"}
        hint="Total size in ~mods"
      />

      <Tile
        icon="warning"
        label="Conflicts"
        tone={conflicts > 0 ? "warning" : "success"}
        selected={filter === "conflict"}
        onClick={conflicts > 0 ? () => onFilter(filter === "conflict" ? "all" : "conflict") : undefined}
        value={<AnimatedNumber value={conflicts} />}
        hint={
          conflicts === 0
            ? "Every active mod is unique"
            : `${conflicts} contested pakchunk${conflicts === 1 ? "" : "s"}`
        }
      />

      <Tile
        icon="upload"
        label="Updates"
        tone={updates > 0 ? "accent" : "muted"}
        selected={filter === "update"}
        onClick={updates > 0 ? () => onFilter(filter === "update" ? "all" : "update") : onCheckUpdates}
        value={updates > 0 ? <AnimatedNumber value={updates} /> : checkingUpdates ? "…" : "—"}
        hint={
          updates > 0
            ? "Show them"
            : checkingUpdates
              ? "Checking the catalogue"
              : "Check the catalogue"
        }
      />
    </div>
  );
}

const TONES = {
  accent: "text-f1red",
  warning: "text-warning",
  success: "text-success",
  muted: "text-text-secondary",
} as const;

function Tile({
  icon,
  label,
  value,
  hint,
  tone,
  onClick,
  selected,
}: {
  icon: IconName;
  label: string;
  value: React.ReactNode;
  hint: string;
  tone: keyof typeof TONES;
  onClick?: () => void;
  selected?: boolean;
}) {
  const Element = onClick ? "button" : "div";

  return (
    <Element
      onClick={onClick}
      aria-pressed={onClick && selected !== undefined ? selected : undefined}
      className={`pressable flex items-center gap-3 rounded-xl border px-3 py-2 text-left ${
        selected
          ? "border-f1red/45 bg-f1red/10"
          : "border-border-subtle bg-surface/50"
      } ${onClick ? "hover:border-border-strong hover:bg-surface-raised/70" : ""}`}
    >
      <span
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-bg-elevated ${TONES[tone]}`}
      >
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-1.5">
          <span className="font-display text-2xl font-bold leading-none text-text-primary">
            {value}
          </span>
          <span className="text-2xs uppercase tracking-wider text-text-muted">{label}</span>
        </span>
        <span className="mt-0.5 block truncate text-2xs text-text-muted">{hint}</span>
      </span>
    </Element>
  );
}
