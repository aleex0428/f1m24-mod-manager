import { useMemo } from "react";
import { useModStore } from "../store/modStore";

/**
 * Matrix of which enabled mods contest which pakchunk.
 * Only the top mod in the load order actually wins a contested chunk.
 */
export function CompatibilityView() {
  const conflicts = useModStore((s) => s.conflicts);

  const modNames = useMemo(
    () => Array.from(new Set(conflicts.flatMap((c) => c.modNames))).sort(),
    [conflicts]
  );

  if (conflicts.length === 0) {
    return (
      <div className="panel flex items-center gap-3 p-4">
        <svg className="h-5 w-5 flex-shrink-0 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.6}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
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
          <svg className="h-4 w-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          Compatibility matrix
        </h3>
        <span className="chip border-warning/25 bg-warning/10 text-warning">
          {conflicts.length} contested chunk{conflicts.length > 1 ? "s" : ""}
        </span>
      </header>

      <div className="overflow-x-auto p-4">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-56 border-b border-border bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Mod
              </th>
              {conflicts.map((c) => (
                <th
                  key={c.pakchunk}
                  className="border-b border-border px-3 py-2 text-center font-mono text-xs text-text-muted"
                >
                  #{c.pakchunk}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {modNames.map((name) => (
              <tr key={name} className="transition-colors hover:bg-surface-raised/50">
                <td
                  className="sticky left-0 z-10 max-w-[14rem] truncate border-r border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary"
                  title={name}
                >
                  {name}
                </td>
                {conflicts.map((c) => (
                  <td key={c.pakchunk} className="px-3 py-2 text-center">
                    {c.modNames.includes(name) ? (
                      <span className="mx-auto flex h-5 w-5 items-center justify-center rounded border border-warning/50 bg-warning/15">
                        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                      </span>
                    ) : (
                      <span className="mx-auto block h-5 w-5 rounded border border-border-subtle bg-bg-elevated" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
