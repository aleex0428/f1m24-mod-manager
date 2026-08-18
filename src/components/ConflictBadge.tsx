import { Icon } from "./Icon";

interface ConflictBadgeProps {
  /** Pakchunks this mod is fighting over, used for the tooltip. */
  chunks?: number[];
  /** Name of the mod that wins those pakchunks, when this one loses. */
  overriddenBy?: string;
  /** That mod's row number, so this badge can point at it. */
  overriddenByPosition?: number;
}

export function ConflictBadge({
  chunks = [],
  overriddenBy,
  overriddenByPosition,
}: ConflictBadgeProps) {
  const where = chunks.length ? ` on pakchunk ${chunks.join(", ")}` : "";
  const title = overriddenBy
    ? `"${overriddenBy}" sits higher in the load order and wins${where}, so this mod has no effect`
    : `Shares pakchunk ${chunks.join(", ")} with another active mod`;

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
