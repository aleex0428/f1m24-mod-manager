import { memo, useState } from "react";
import { bestImageUrl, hueFor, initialsFor } from "../lib/images";

interface ModCoverProps {
  src?: string;
  /** Used for the generated poster when there is no usable image. */
  name: string;
  /**
   * `fit` letterboxes the image at its real size over a blurred copy of
   * itself — for any box wider than the source is square.
   * `fill` covers the box, and is only correct where the box is *smaller*
   * than the source, so covering still means scaling down.
   */
  mode?: "fit" | "fill";
  className?: string;
  /** Grows the blurred backdrop slightly while the card is hovered. */
  reactive?: boolean;
}

/**
 * A mod's picture, never enlarged.
 *
 * The catalogue only has 96×96 icons, and the grid box is roughly 285×160, so
 * the obvious `object-cover` was asking the browser to invent two thirds of
 * every pixel on screen — and to crop the top and bottom off a square while it
 * was at it. This draws the image at its own size, centred, and fills the rest
 * with a heavily blurred copy of the same image.
 *
 * The blur is what makes it work: nobody perceives missing resolution in
 * something that is deliberately out of focus, so the 96px source is a
 * perfectly good backdrop even stretched across the whole card, while the
 * copy you actually read stays pixel-exact. The card also picks up the mod's
 * own colours for free.
 *
 * `max-width/height` with no `width`/`height` is the mechanism: an <img> with
 * only maximums renders at its intrinsic size and shrinks if the box is
 * smaller — it can never grow. Swapping those for `w-full h-full` would
 * silently reintroduce the whole problem.
 */
function ModCoverBase({ src, name, mode = "fit", className = "", reactive }: ModCoverProps) {
  const [failed, setFailed] = useState(false);
  const url = failed ? undefined : bestImageUrl(src);

  if (!url) return <GeneratedPoster name={name} className={className} />;

  if (mode === "fill") {
    return (
      <span className={`block overflow-hidden bg-bg-elevated ${className}`}>
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span className={`relative block overflow-hidden bg-bg-elevated ${className}`}>
      {/* Backdrop: the same file, blown up and blurred into a colour wash.
          Cheap because the source is 96px — there is very little to blur. */}
      {/* The base scale is a class, not an inline style: an inline `transform`
          would win over the hover utility and the card would never react. */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 scale-[1.8] bg-cover bg-center transition-transform duration-slow ease-out-expo ${
          reactive ? "group-hover:scale-[2.1]" : ""
        }`}
        style={{
          backgroundImage: `url(${url})`,
          filter: "blur(22px) saturate(1.5) brightness(0.55)",
        }}
      />

      {/* The readable copy, at its own resolution and no larger. */}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="absolute left-1/2 top-1/2 max-h-[86%] max-w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-elev-2"
      />
    </span>
  );
}

export const ModCover = memo(ModCoverBase);

/**
 * The card for a mod that ships no image at all.
 *
 * Initials over a hue derived from the name: eleven identical grey
 * placeholders tell you nothing, whereas eleven different coloured ones are at
 * least distinguishable from each other at a glance. Deterministic, so a mod
 * keeps its colour between launches.
 */
function GeneratedPoster({ name, className = "" }: { name: string; className?: string }) {
  const hue = hueFor(name);

  return (
    <span
      className={`flex items-center justify-center overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 42% 26%) 0%, hsl(${(hue + 40) % 360} 38% 14%) 100%)`,
      }}
      aria-hidden="true"
    >
      <span
        className="font-display text-2xl font-black tracking-tight"
        style={{ color: `hsl(${hue} 55% 78%)` }}
      >
        {initialsFor(name)}
      </span>
    </span>
  );
}
