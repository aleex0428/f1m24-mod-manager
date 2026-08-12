interface BackgroundBlurProps {
  imageUrl?: string;
}

/**
 * Soft colour wash behind a modal.
 *
 * The previous version applied `filter: blur(80px)` to a full-screen image,
 * which forces a very expensive off-screen render every frame. A scaled-down
 * image plus gradients gets the same look for almost nothing.
 */
export function BackgroundBlur({ imageUrl }: BackgroundBlurProps) {
  if (!imageUrl) return null;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "saturate(1.4)",
          transform: "scale(1.15)",
        }}
      />
      <div className="absolute inset-0 bg-bg/80" />
      <div className="absolute inset-0 bg-gradient-to-b from-bg/60 via-bg/85 to-bg" />
    </div>
  );
}
