"use client";

import { useNetworkGuard } from "../lib/hooks/useNetworkGuard";

/**
 * Blocking banner shown whenever the wallet's active network doesn't match
 * the app's expected network, or when Freighter detects an account change
 * that has already invalidated the session.
 *
 * Mount this once in the app shell (layout or AppHeader) so it appears on
 * every page. While the banner is visible, call sites should also disable
 * any sign/submit action — use `useNetworkGuard().status !== "ok"` for that
 * guard at the call site; this component only handles the visual side.
 */
export function NetworkMismatchBanner() {
  const state = useNetworkGuard();

  if (state.status === "ok") return null;

  if (state.status === "account-changed") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 200,
          background: "var(--put-dim)",
          borderBottom: "1px solid var(--put)",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          fontSize: 12,
        }}
      >
        <span style={{ color: "var(--text-hi)" }}>
          <span style={{ color: "var(--put)", fontWeight: 700, marginRight: 6 }}>
            ⚠ Account switched.
          </span>
          Your Freighter account changed. Your session has been cleared — please
          reconnect to continue.
        </span>
      </div>
    );
  }

  if (state.status === "mismatch") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 200,
          background: "var(--put-dim)",
          borderBottom: "1px solid var(--put)",
          padding: "8px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--put)", fontWeight: 700 }}>⚠ Network mismatch</span>
          <span style={{ color: "var(--text-hi)" }}>
            All sign actions are disabled until you switch your wallet network.
          </span>
        </div>
        <div style={{ color: "var(--text-mid)" }}>
          This app is connected to{" "}
          <span style={{ color: "var(--brand)", fontWeight: 600 }}>{state.expectedNetwork}</span>
          , but your Freighter wallet is set to{" "}
          <span style={{ color: "var(--put)", fontWeight: 600 }}>{state.walletNetwork}</span>.
        </div>
        <ol
          style={{
            margin: 0,
            paddingLeft: 18,
            color: "var(--text-mid)",
            lineHeight: 1.8,
          }}
        >
          <li>Open the Freighter extension (click its icon in your browser toolbar).</li>
          <li>
            Click the network name in the top-right of the extension (
            <em>{state.walletNetwork}</em>).
          </li>
          <li>
            Select <strong style={{ color: "var(--text-hi)" }}>{state.expectedNetwork}</strong>{" "}
            from the list.
          </li>
          <li>Return here — this banner will disappear automatically.</li>
        </ol>
      </div>
    );
  }

  // status === "error"
  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 200,
        background: "var(--atm-dim)",
        borderBottom: "1px solid var(--atm)",
        padding: "6px 16px",
        fontSize: 12,
        color: "var(--text-mid)",
      }}
    >
      <span style={{ color: "var(--atm)", fontWeight: 600, marginRight: 6 }}>⚠</span>
      Could not verify wallet network: {(state as { status: "error"; message: string }).message}
    </div>
  );
}
