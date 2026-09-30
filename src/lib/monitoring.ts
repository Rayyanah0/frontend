/**
 * Monitoring facade — src/lib/monitoring.ts
 *
 * Thin abstraction over the underlying observability vendor (Sentry by
 * default) so the rest of the codebase never imports @sentry/* directly.
 * Swapping vendors only requires changing this file.
 *
 * Usage:
 *   import { captureError, captureMessage, startSpan } from "@/lib/monitoring";
 *
 *   captureError(err, { context: "trade-submit" });
 *   const result = await startSpan("chain.load", async () => fetchChain(...));
 */

// Dynamic import keeps Sentry out of the initial JS bundle.  It resolves
// immediately in all non-SSR environments because the SDK is side-effect-
// free; the dynamic() only prevents it from being included in the page's
// initial chunk parse.
let _sentry: typeof import("@sentry/nextjs") | null = null;

async function getSentry() {
  if (_sentry) return _sentry;
  try {
    _sentry = await import("@sentry/nextjs");
  } catch {
    // Sentry not installed (e.g. running locally without DSN) — no-op.
    _sentry = null;
  }
  return _sentry;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ErrorContext {
  /** Free-form label for where the error originated (e.g. "trade-submit") */
  context?: string;
  /** Extra key/value pairs attached to the event */
  extra?: Record<string, unknown>;
  /** Sentry fingerprint override */
  fingerprint?: string[];
}

/**
 * Report an unexpected error.  Safe to call anywhere — no-ops if Sentry
 * is not configured.
 */
export async function captureError(err: unknown, ctx?: ErrorContext): Promise<void> {
  const s = await getSentry();
  if (!s) return;

  s.withScope((scope) => {
    if (ctx?.context) scope.setTag("context", ctx.context);
    if (ctx?.extra) {
      for (const [k, v] of Object.entries(ctx.extra)) scope.setExtra(k, v);
    }
    if (ctx?.fingerprint) scope.setFingerprint(ctx.fingerprint);
    s.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

/**
 * Report an informational message (non-error).
 */
export async function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info"
): Promise<void> {
  const s = await getSentry();
  if (!s) return;
  s.captureMessage(message, level);
}

/**
 * Wrap an async operation in a performance span.
 *
 *   const data = await startSpan("chain.load", () => fetchChain(sym, days));
 */
export async function startSpan<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const s = await getSentry();
  if (!s) return fn();

  return s.startSpan({ name, op: name }, () => fn());
}

/**
 * Set the current user identity (wallet address, hashed).
 * Call this after a successful wallet connection.
 */
export async function setUser(hashedAddress: string | null): Promise<void> {
  const s = await getSentry();
  if (!s) return;
  if (hashedAddress) {
    s.setUser({ id: hashedAddress });
  } else {
    s.setUser(null);
  }
}
