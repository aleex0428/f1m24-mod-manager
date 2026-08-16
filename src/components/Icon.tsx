import { memo } from "react";

/**
 * The app's icon set.
 *
 * Every icon used to be pasted inline where it was needed, which meant the
 * same glyph appeared with `strokeWidth` anywhere between 1 and 2.5 depending
 * on the file — the single biggest reason the interface looked hand-assembled
 * rather than designed. They all live here now, drawn on the same 24-unit grid
 * at the same weight, so a stroke change is one edit.
 *
 * Filled glyphs (`play`, `grip`, `warning-solid`) are marked as such: they are
 * filled because a hairline outline reads as noise at 12-16px, not because
 * they were drawn differently.
 */

interface Glyph {
  /** One or more path commands, drawn in order. */
  d: string | string[];
  /** Filled rather than stroked. */
  filled?: boolean;
  /** Non-default viewBox, for the few glyphs drawn on a 20-unit grid. */
  box?: string;
  /** Extra shapes that are not paths (the drag handle's dots). */
  circles?: [number, number, number][];
}

const GLYPHS = {
  // ── Navigation ────────────────────────────────────────────
  library:
    "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  browse:
    "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9",
  settings: {
    d: [
      "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z",
      "M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    ],
  },
  "panel-left": {
    d: ["M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z", "M10 4v16"],
  },

  // ── Actions ───────────────────────────────────────────────
  download: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4 4m0 0l-4-4m4 4V4",
  upload: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
  refresh:
    "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  undo: "M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4",
  plus: "M12 4v16m8-8H4",
  close: "M6 18L18 6M6 6l12 12",
  check: "M5 13l4 4L19 7",
  trash:
    "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  folder: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  external: "M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14",
  link: "M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 11-5.656-5.656l1.5-1.5m4.5-4.5l1.5-1.5a4 4 0 115.656 5.656l-3 3a4 4 0 01-5.656 0",
  play: { d: "M8 5v14l11-7z", filled: true },
  power: "M18.36 6.64a9 9 0 11-12.73 0M12 2v10",
  filter: "M3 5h18M6 12h12M10 19h4",
  bolt: "M13 10V3L4 14h7v7l9-11h-7z",

  // ── Chevrons & arrows ─────────────────────────────────────
  "chevron-up": "M5 15l7-7 7 7",
  "chevron-down": "M19 9l-7 7-7-7",
  "chevron-left": "M15 19l-7-7 7-7",
  "chevron-right": "M9 5l7 7-7 7",

  // ── Status ────────────────────────────────────────────────
  bell: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  warning: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  "warning-solid": {
    d: "M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z",
    filled: true,
    box: "0 0 20 20",
  },
  "check-circle": "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  lock: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",

  // ── Objects ───────────────────────────────────────────────
  cube: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  image:
    "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  inbox:
    "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4",
  disk: {
    d: [
      "M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3z",
      "M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7",
      "M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3",
    ],
  },

  // ── View modes ────────────────────────────────────────────
  list: "M4 6h16M4 12h16M4 18h16",
  grid: {
    d: [
      "M4 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5z",
      "M13 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1V5z",
      "M4 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5z",
      "M13 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1v-5z",
    ],
  },
  rows: {
    d: [
      "M4 6a1 1 0 011-1h14a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1V6z",
      "M4 15a1 1 0 011-1h14a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3z",
    ],
  },

  // ── Drag handle ───────────────────────────────────────────
  grip: {
    d: [],
    filled: true,
    box: "0 0 20 20",
    circles: [
      [7, 5, 1.5],
      [13, 5, 1.5],
      [7, 10, 1.5],
      [13, 10, 1.5],
      [7, 15, 1.5],
      [13, 15, 1.5],
    ],
  },

  // ── Command palette ───────────────────────────────────────
  command: "M6 3a3 3 0 013 3v12a3 3 0 11-3-3h12a3 3 0 11-3 3V6a3 3 0 113 3H6a3 3 0 01-3-3z",
  keyboard: {
    d: [
      "M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
      "M7 9h.01M11 9h.01M15 9h.01M17 9h.01M7 13h.01M9 16h6",
    ],
  },
} satisfies Record<string, string | Glyph>;

export type IconName = keyof typeof GLYPHS;

interface IconProps {
  name: IconName;
  /** Edge length in pixels. 16 is the body size; 18 for navigation. */
  size?: number;
  className?: string;
  /** Only for the rare glyph that needs to read heavier, e.g. a checkmark. */
  strokeWidth?: number;
}

/** One weight for the whole app. */
const STROKE = 1.6;

function IconBase({ name, size = 16, className = "", strokeWidth }: IconProps) {
  const entry: string | Glyph = GLYPHS[name];
  const glyph: Glyph = typeof entry === "string" ? { d: entry } : entry;
  const paths = Array.isArray(glyph.d) ? glyph.d : [glyph.d];

  return (
    <svg
      width={size}
      height={size}
      viewBox={glyph.box ?? "0 0 24 24"}
      className={`flex-shrink-0 ${className}`}
      fill={glyph.filled ? "currentColor" : "none"}
      stroke={glyph.filled ? "none" : "currentColor"}
      strokeWidth={glyph.filled ? undefined : (strokeWidth ?? STROKE)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.filter(Boolean).map((d) => (
        <path key={d} d={d} fillRule={glyph.filled ? "evenodd" : undefined} clipRule={glyph.filled ? "evenodd" : undefined} />
      ))}
      {glyph.circles?.map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
      ))}
    </svg>
  );
}

export const Icon = memo(IconBase);

/** Spinner, the one "icon" that is an animation rather than a glyph. */
export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block flex-shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
