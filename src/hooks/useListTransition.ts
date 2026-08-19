import { useLayoutEffect, useRef } from "react";

/**
 * Slides rows to their new positions when a list is filtered or re-sorted.
 *
 * Filtering used to be instantaneous in the literal sense: rows vanished and
 * the rest snapped upwards, so the eye had nothing to follow and the result
 * read as "the list changed" rather than "those ones were removed".
 *
 * This is the FLIP technique — measure where every row was, let React render,
 * then animate each row from its old position to its new one. It uses the Web
 * Animations API directly rather than a layout library: the whole thing is
 * thirty lines, and adding a dependency for it would be the larger cost.
 *
 * Deliberately *not* applied while dragging. dnd-kit already owns the
 * transforms then, and two systems animating the same element fight.
 */
export function useListTransition(
  container: React.RefObject<HTMLElement>,
  /** Changes to this trigger a measurement. The visible ids, joined. */
  signature: string,
  enabled = true
) {
  const previous = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;

    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id]"));
    const before = previous.current;

    if (enabled && before.size > 0) {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

      if (!reduced) {
        for (const row of rows) {
          const id = row.dataset.rowId;
          if (!id) continue;

          const old = before.get(id);
          const now = row.getBoundingClientRect();
          if (!old) continue;

          const dy = old.top - now.top;
          // Sub-pixel shifts are not worth an animation, and animating every
          // row on every keystroke of a filter would be its own problem.
          if (Math.abs(dy) < 2) continue;

          row.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
            { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
          );
        }
      }
    }

    // Record where everything ended up, for the next change.
    const next = new Map<string, DOMRect>();
    for (const row of rows) {
      const id = row.dataset.rowId;
      if (id) next.set(id, row.getBoundingClientRect());
    }
    previous.current = next;
  }, [container, signature, enabled]);
}
