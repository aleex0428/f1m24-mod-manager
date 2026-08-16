import { useEffect, useRef, useState } from "react";

/**
 * A number that counts to its new value instead of jumping to it.
 *
 * Used for the library's summary figures, where the movement is the point: it
 * is what tells you that toggling a mod changed the count you were not looking
 * at. Anywhere the number is data rather than feedback — file sizes, byte
 * counters, versions — it should be rendered plainly.
 *
 * Honours `prefers-reduced-motion` by snapping, and never animates the first
 * paint, which would otherwise mean every figure in the app races up from zero
 * on launch.
 */
export function AnimatedNumber({
  value,
  duration = 420,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);
  const frame = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!mounted.current || reduced || from === value) {
      mounted.current = true;
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Same decelerating curve as the rest of the interface.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration]);

  return <span className={className}>{display}</span>;
}
