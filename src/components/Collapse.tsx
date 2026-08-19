import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveals its children by animating their real height.
 *
 * The strips this wraps sit *above* the mod list and push it down, so appearing
 * instantly moves everything you were looking at by fifty pixels with no
 * warning. Animating the height is what turns that into something the eye can
 * follow.
 *
 * `height: auto` is not animatable, so the height is measured and set as a
 * pixel value for the duration, then released back to `auto` — otherwise a
 * notice whose text wraps differently later would be clipped at whatever it
 * measured once.
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">(open ? "auto" : 0);
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The first render must not animate: a panel that opens by itself on mount
    // reads as a glitch rather than as a response to anything.
    if (first.current) {
      first.current = false;
      setHeight(open ? "auto" : 0);
      return;
    }

    if (open) {
      setHeight(el.scrollHeight);
      // Release to auto once the transition has landed, so later content
      // changes are not clipped to the height measured now.
      const timer = window.setTimeout(() => setHeight("auto"), 220);
      return () => window.clearTimeout(timer);
    }

    // Closing from `auto` would jump straight to zero with nothing to
    // interpolate, so pin the current height for a frame first.
    setHeight(el.scrollHeight);
    const frame = requestAnimationFrame(() => setHeight(0));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <div
      style={{
        height: height === "auto" ? undefined : height,
        overflow: height === "auto" ? undefined : "hidden",
      }}
      className="transition-[height] duration-base ease-out-expo"
      aria-hidden={!open}
    >
      <div ref={ref}>{children}</div>
    </div>
  );
}
