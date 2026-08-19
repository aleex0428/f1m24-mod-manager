import { Icon } from "./Icon";

interface ConflictBadgeProps {
  /** Pakchunks this mod is fighting over, used for the tooltip. */
  chunks?: number[];
  /** Files it shares with the mod that beats it, when they could be read. */
  files?: string[];
  /** False when the clash is inferred from pakchunks rather than measured. */
  certain?: boolean;
  /** Name of the mod that wins those pakchunks, when this one loses. */
  overriddenBy?: string;
  /** That mod's row number, so this badge can point at it. */
  overriddenByPosition?: number;
}

export function ConflictBadge({
  chunks = [],
  files = [],
  certain,
  overriddenBy,
  overriddenByPosition,
}: ConflictBadgeProps) {
  // Say what was actually measured. "Shares 3 files" is a fact; "shares a
  // pakchunk" is a guess that happens to be right most of the time, and the
  // tooltip should not present the two the same way.
  const shown = files.slice(0, 6).join("\n");
  const rest = files.length > 6 ? `\n…and ${files.length - 6} more` : "";

  const where = certain
    ? files.length > 0
      ? `:\n${shown}${rest}`
      : ""
    : chunks.length
      ? ` — estimated from pakchunk ${chunks.join(", ")}, its contents could not be read`
      : "";

  const title = overriddenBy
    ? certain
      ? `"${overriddenBy}" sits higher in the load order and replaces the same ${files.length} file${
          files.length === 1 ? "" : "s"
        }, so this mod has no effect${where}`
      : `"${overriddenBy}" sits higher in the load order and probably wins${where}`
    : certain
      ? `Replaces ${files.length} file${files.length === 1 ? "" : "s"} another active mod also replaces${where}`
      : `Shares a pakchunk with another active mod${where}`;

  return (
    <span className="chip border-warning/25 bg-warning/10 text-warning" title={title}>
      <Icon name="warning-solid" size={12} />
      {overriddenBy ? (
        <>
          {/* The row number first: it is what lets you find the culprit in a
              long list, which the name alone does not. */}
          {overriddenByPosition !== undefined && (
            <span className="font-mono">
              ↑ {overriddenByPosition.toString().padStart(2, "0")}
            </span>
          )}
          <span className="max-w-[10rem] truncate normal-case">{overriddenBy}</span>
        </>
      ) : (
        "Conflict"
      )}
    </span>
  );
}
