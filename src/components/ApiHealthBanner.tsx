"use client";

import { useApiHealth } from "../lib/hooks/useApiHealth";

/**
 * Degraded-mode strip shown under the header when the API client is
 * throttled (429/503 Retry-After) or the circuit breaker is open. Requests
 * fail fast locally during these windows, so the UI explains why data is
 * stale instead of showing a wall of errors.
 */
export function ApiHealthBanner() {
  const status = useApiHealth();
  if (status.kind === "ok") return null;

  const secs = Math.ceil(status.retryInMs / 1000);
  const message = status.kind === "rate_limited"
    ? `Rate limited by the Zenith backend — pausing requests${secs > 0 ? ` for ${secs}s` : ""}.`
    : status.probing
      ? "Zenith backend degraded — checking whether it has recovered…"
      : `Zenith backend degraded — showing last known data. Retrying${secs > 0 ? ` in ${secs}s` : " shortly"}.`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="api-health-banner"
      data-state={status.kind}
      style={{
        padding: "6px 16px",
        fontSize: 11,
        borderBottom: "1px solid var(--border-default)",
        background: status.kind === "degraded" ? "var(--put-dim, rgba(220,80,80,0.12))" : "var(--atm-dim)",
        color: status.kind === "degraded" ? "var(--put)" : "var(--atm)",
      }}
    >
      {message} Trades are not resubmitted automatically.
    </div>
  );
}
