import type { ReactNode } from "react";

/**
 * What a screen shows when there is nothing on it.
 *
 * These were an outlined icon and one grey sentence — which is what an empty
 * state looks like when nobody decided what it should say. They matter more
 * than their usage stats suggest: the empty library is the *first* thing a new
 * user sees, and every other one appears at a moment when something the user
 * expected to work did not.
 *
 * The artwork is drawn from the same primitives as the rest of the interface —
 * the accent, the surfaces, a couple of strokes — rather than being an
 * illustration bolted on. It is meant to read as part of the app.
 */
export function EmptyState({
  art,
  title,
  description,
  action,
}: {
  art: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-6 animate-fade-in">{art}</div>
      <h3 className="font-display text-xl font-bold text-text-primary">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-text-muted">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Shared frame so every piece of artwork sits on the same footprint. */
function Art({ children }: { children: ReactNode }) {
  return (
    <svg
      width="132"
      height="96"
      viewBox="0 0 132 96"
      fill="none"
      aria-hidden="true"
      className="overflow-visible"
    >
      {children}
    </svg>
  );
}

/** An empty garage: three slots, nothing parked. */
export function NoModsArt() {
  return (
    <Art>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={6 + i * 42}
          y={26}
          width={36}
          height={44}
          rx={6}
          className="fill-surface stroke-border"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      ))}
      {/* One slot lit, to say where the first one goes. */}
      <rect
        x={48}
        y={26}
        width={36}
        height={44}
        rx={6}
        className="fill-f1red/10 stroke-f1red/50"
        strokeWidth={1.5}
      />
      <path
        d="M66 40v16M58 48h16"
        className="stroke-f1red"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path d="M2 78h128" className="stroke-border" strokeWidth={1.5} strokeLinecap="round" />
    </Art>
  );
}

/** Shelves with nothing on them: the catalogue before its first sync. */
export function EmptyCatalogueArt() {
  return (
    <Art>
      {[0, 1].map((row) => (
        <g key={row}>
          {[0, 1, 2, 3].map((col) => (
            <rect
              key={col}
              x={8 + col * 30}
              y={12 + row * 34}
              width={24}
              height={24}
              rx={4}
              className="fill-surface stroke-border"
              strokeWidth={1.4}
            />
          ))}
        </g>
      ))}
      <circle cx={104} cy={72} r={18} className="fill-bg-elevated stroke-border-strong" strokeWidth={1.5} />
      <path
        d="M96 72a8 8 0 0113.6-5.7M112 72a8 8 0 01-13.6 5.7"
        className="stroke-f1red"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path d="M110 62v5h-5M98 82v-5h5" className="stroke-f1red" strokeWidth={2} strokeLinecap="round" />
    </Art>
  );
}

/** A magnifier over nothing: a search that matched no rows. */
export function NoResultsArt() {
  return (
    <Art>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={10}
          y={18 + i * 22}
          width={78}
          height={14}
          rx={4}
          className="fill-surface"
          opacity={0.5 - i * 0.15}
        />
      ))}
      <circle cx={96} cy={44} r={20} className="fill-bg-elevated/80 stroke-border-strong" strokeWidth={2} />
      <path d="M110 58l14 14" className="stroke-f1red" strokeWidth={3} strokeLinecap="round" />
    </Art>
  );
}

/** An empty pit lane: no downloads in flight. */
export function NoDownloadsArt() {
  return (
    <Art>
      <path d="M6 68h120" className="stroke-border" strokeWidth={1.5} strokeLinecap="round" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect
          key={i}
          x={8 + i * 21}
          y={62}
          width={10}
          height={4}
          rx={1}
          className={i % 2 === 0 ? "fill-border-strong" : "fill-surface"}
        />
      ))}
      <path
        d="M66 16v30M54 36l12 12 12-12"
        className="stroke-border-strong"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Art>
  );
}
