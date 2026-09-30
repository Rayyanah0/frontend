/**
 * Parse a Retry-After header (RFC 9110 §10.2.3) into a delay in ms.
 * Accepts delta-seconds ("120") or an HTTP-date. Returns null when absent or
 * unparseable; negative / past values clamp to 0; huge values clamp to `maxMs`.
 */
export function parseRetryAfter(header: string | null | undefined, now = Date.now(), maxMs = 5 * 60_000): number | null {
  if (header == null) return null;
  const value = header.trim();
  if (value === "") return null;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return maxMs;
    return Math.min(seconds * 1000, maxMs);
  }

  // HTTP-date — only accept strings that look like one (Date.parse is lenient).
  if (!/[a-z]{3},?\s|GMT|UTC/i.test(value)) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), maxMs);
}
