/**
 * Everything the app knows about the pictures it did not take.
 *
 * The catalogue's images are XenForo *resource icons*: 96×96, with no larger
 * variant on the server (every candidate path — /l/, /o/, a `_full` suffix —
 * answers 404). That single fact drives the rules here and the way `ModCover`
 * lays them out: the source is small, so nothing may ever scale it up.
 */

/**
 * Ask for the largest variant the server actually has.
 *
 * A handful of mods have no resource icon and fall back to the author's
 * avatar, which the listing links at XenForo's *small* size — 48px, half of
 * even the icons. Avatars, unlike resource icons, really do come in sizes:
 * `s` 48, `m` 96, `l` 192, `o` original. Asking for `l` is four times the
 * pixels for one character of URL.
 *
 * Applied on read rather than only at scrape time, so a catalogue that is
 * already on disk improves without being synced again. If a large variant
 * turns out to be missing the image 404s and `ModCover` falls back to the
 * generated poster, exactly as it does for a mod with no image at all.
 */
export function bestImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/avatars\/s\//, "/avatars/l/");
}

/** Words that say nothing about which mod this is. */
const NOISE = new Set([
  "the", "a", "an", "and", "of", "for", "mod", "pack", "by", "v", "version",
  "f1", "2024", "2025", "2026",
]);

/**
 * Initials for a mod with no image.
 *
 * Skips the words every second mod in the list shares, so "F1 2026 Real
 * Results Mod" reads as RR rather than F2 — the whole point is telling the
 * blank cards apart from each other.
 */
export function initialsFor(name: string): string {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    // Bare numbers are dropped, not just the years in NOISE: mod names are
    // full of them ("F1 Manager 24 Voice Manager" produced "M2" before this,
    // which identifies nothing — "MV" at least points at Voice Manager).
    .filter((w) => w.length > 0 && !/^\d+$/.test(w) && !NOISE.has(w.toLowerCase()));

  const source = words.length > 0 ? words : name.split(/\s+/).filter(Boolean);
  if (source.length === 0) return "?";
  if (source.length === 1) return source[0].slice(0, 2).toUpperCase();
  return (source[0][0] + source[1][0]).toUpperCase();
}

/**
 * A stable hue for a name.
 *
 * The same mod must get the same colour every time — a card that changes
 * colour between launches is worse than a grey one — so this is a plain
 * deterministic hash, not a random pick. Reds near the accent are skipped so a
 * generated poster is never mistaken for a selected or erroring card.
 */
export function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  // 25..355 in steps, avoiding the 0-24 / 356-360 band the F1 red occupies.
  return 25 + (Math.abs(hash) % 330);
}
