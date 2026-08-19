import { useMemo } from "react";
import { useModStore } from "../store/modStore";
import { Icon } from "./Icon";

/**
 * Which mods are fighting over what, and who wins.
 *
 * This used to be a matrix: one column per contested pakchunk, one row per mod,
 * a dot where they met. It read well with two conflicts and became a
 * horizontally-scrolling grid of dots with ten — at which point it stopped
 * answering the only question anyone actually has, which is "so which one is
 * the game using?".
 *
 * Grouped by chunk instead, with the winner named. The winner is whichever
 * contender sits highest in the *applied* load order, which is the same rule
 * the library uses for its badges — read from `loadOrder`, not from a pending
 * drag, because until Apply is pressed the game still sees the old order.
 */
export function CompatibilityView() {
  const conflicts = useModStore((s) => s.conflicts);
  const mods = useModStore((s) => s.mods);

  const groups = useMemo(() => {
    const order = new Map(mods.map((m) => [m.id, m.loadOrder]));
    const names = new Map(mods.map((m) => [m.id, m.name]));
    const enabled = new Set(mods.filter((m) => m.enabled).map((m) => m.id));

    return conflicts
      .map((conflict) => {
        const contenders = conflict.mods.filter((id) => enabled.has(id));
        if (contenders.length < 2) return null;

        // Lowest loadOrder is highest priority — the top of the list wins.
        const winner = contenders.reduce((best, id) =>
          (order.get(id) ?? 0) < (order.get(best) ?? 0) ? id : best
        );

        return {
          pakchunk: conflict.pakchunk,
          files: conflict.files,
          certain: conflict.certain,
          winner: names.get(winner) ?? "Unknown",
          losers: contenders.filter((id) => id !== winner).map((id) => names.get(id) ?? "Unknown"),
        };
      })
      .filter((group): group is NonNullable<typeof group> => group !== null);
  }, [conflicts, mods]);

  if (groups.length === 0) {
    return (
      <div className="panel flex items-center gap-3 p-4">
        <Icon name="check-circle" size={20} className="text-success" />
        <div>
          <p className="text-sm font-medium text-success">No conflicts</p>
          <p className="text-xs text-text-muted">Every active mod owns a different pakchunk.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-surface-raised/60 px-4 py-3">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-text-primary">
          <Icon name="warning" size={16} className="text-warning" />
          What is overriding what
        </h3>
        <span className="chip border-warning/25 bg-warning/10 text-warning">
          {groups.length} contested chunk{groups.length > 1 ? "s" : ""}
        </span>
      </header>

      <ul className="divide-y divide-border-subtle">
        {groups.map((group, index) => (
          <li key={`${group.pakchunk}-${index}`} className="px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="font-mono text-2xs uppercase tracking-wider text-text-muted">
                {group.pakchunk >= 0 ? `pakchunk ${group.pakchunk}` : "shared files"}
              </p>
              {/* Fact and guess look different on purpose. */}
              {group.certain ? (
                <span className="chip border-info/25 bg-info/10 text-info">
                  {group.files.length} file{group.files.length === 1 ? "" : "s"} in common
                </span>
              ) : (
                <span
                  className="chip border-border bg-surface-raised text-text-muted"
                  title="These mods claim the same pakchunk, but their contents could not be read — they may not touch the same files at all."
                >
                  Estimated
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Icon name="check-circle" size={15} className="flex-shrink-0 text-success" />
              <span className="min-w-0 truncate text-sm font-medium text-text-primary" title={group.winner}>
                {group.winner}
              </span>
              <span className="chip flex-shrink-0 border-success/25 bg-success/10 text-success">
                Applied
              </span>
            </div>

            {/* Indented under the winner: these are covered *by* it, and the
                indent is what says so without another sentence. */}
            <ul className="mt-1.5 space-y-1 border-l border-border pl-4 [margin-left:0.44rem]">
              {group.losers.map((name) => (
                <li key={name} className="flex items-center gap-2 text-xs text-text-muted">
                  <span className="truncate" title={name}>
                    {name}
                  </span>
                  <span className="flex-shrink-0 text-2xs uppercase tracking-wider text-warning/80">
                    no effect
                  </span>
                </li>
              ))}
            </ul>

            {group.certain && group.files.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-2xs text-text-muted hover:text-text-secondary">
                  Which files
                </summary>
                <ul className="mt-1.5 space-y-0.5">
                  {group.files.slice(0, 12).map((file) => (
                    <li
                      key={file}
                      className="truncate font-mono text-2xs text-text-muted"
                      title={file}
                    >
                      {file}
                    </li>
                  ))}
                  {group.files.length > 12 && (
                    <li className="text-2xs text-text-muted">
                      …and {group.files.length - 12} more
                    </li>
                  )}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>

      <footer className="border-t border-border-subtle px-4 py-2.5 text-2xs leading-relaxed text-text-muted">
        Only the mod highest in the load order applies. Move a mod up to make it win, or disable
        the ones you do not want. Entries marked <span className="text-text-secondary">Estimated</span>{" "}
        share a pakchunk but their contents could not be read, so they may not clash at all.
      </footer>
    </section>
  );
}
