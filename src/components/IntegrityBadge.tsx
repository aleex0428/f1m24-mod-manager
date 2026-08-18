import { Icon } from "./Icon";
import type { ModIntegrity } from "../types";

const COPY: Record<
  Exclude<ModIntegrity, "ok">,
  { label: string; tone: string; title: string }
> = {
  missing: {
    label: "Missing",
    tone: "border-danger/30 bg-danger/10 text-danger",
    title:
      "None of this mod's files are in ~mods any more. A game update or a manual clean-up removes them; the entry is all that is left.",
  },
  incomplete: {
    label: "Incomplete",
    tone: "border-warning/30 bg-warning/10 text-warning",
    title:
      "Some of this mod's files are missing. A .pak without its .ucas/.utoc siblings will not load, and may stop the game loading at all.",
  },
  modified: {
    label: "Modified",
    tone: "border-info/30 bg-info/10 text-info",
    title:
      "The files are there but no longer match what was installed — edited by hand, or replaced by another mod's install.",
  },
};

/**
 * Says that the library and the disk disagree.
 *
 * Deliberately absent when everything is fine: a badge on every healthy row
 * would be noise, and the whole value here is that the exceptions stand out.
 */
export function IntegrityBadge({ integrity }: { integrity: ModIntegrity }) {
  if (integrity === "ok") return null;
  const { label, tone, title } = COPY[integrity];

  return (
    <span className={`chip flex-shrink-0 ${tone}`} title={title}>
      <Icon name="warning-solid" size={12} />
      {label}
    </span>
  );
}
