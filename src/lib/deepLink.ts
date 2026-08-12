/**
 * Extract the target mod URL from a deep link string.
 *
 * Example input:
 *   "f1m24://install?url=https://www.overtake.gg/downloads/example-mod.1234/"
 * Output:
 *   "https://www.overtake.gg/downloads/example-mod.1234/"
 */
export function extractUrlFromDeepLink(deepLink: string): string | null {
  if (!deepLink) return null;

  try {
    const parsed = new URL(deepLink);
    const paramUrl = parsed.searchParams.get("url");
    if (paramUrl) {
      return paramUrl;
    }
  } catch {
    // Custom scheme parsing fallback
  }

  // Regex fallback for ?url=... or &url=...
  const match = deepLink.match(/[?&]url=([^&]+)/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  // Direct HTTP/HTTPS link fallback
  if (deepLink.startsWith("http://") || deepLink.startsWith("https://")) {
    return deepLink;
  }

  return null;
}
