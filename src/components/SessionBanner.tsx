"use client";

import { useEffect, useState } from "react";
import { useWalletStore } from "../lib/store/wallet";
import { useHydrated } from "../lib/useHydrated";

const WARN_BEFORE_MS = 10 * 60 * 1000;

/** Persistent banner for an expired session and a proactive warning 10 minutes before expiry. */
export function SessionBanner() {
  const hydrated = useHydrated();
  const { token, tokenExpiresAt, sessionExpired, reauthenticate } = useWalletStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  if (!hydrated) return null;
  const expired = sessionExpired || (!!token && !!tokenExpiresAt && tokenExpiresAt <= now);
  const expiringSoon = !!token && !!tokenExpiresAt && tokenExpiresAt > now && tokenExpiresAt - now < WARN_BEFORE_MS;
  if (!expired && !expiringSoon) return null;

  return (
    <div
      role={expired ? "alert" : "status"}
      style={{
        padding: "6px 16px", fontSize: 12, display: "flex", gap: 12, alignItems: "center",
        background: "var(--bg-raised)", borderBottom: `1px solid ${expired ? "var(--put)" : "var(--atm)"}`, color: "var(--text-hi)",
      }}
    >
      <span>
        {expired
          ? "Session expired — sign in to see your positions."
          : `Session expires in ${Math.max(1, Math.round((tokenExpiresAt! - now) / 60000))} min.`}
      </span>
      <button onClick={reauthenticate} style={{ background: "var(--brand)", color: "var(--bg)", border: "none", padding: "3px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
        {expired ? "Sign in" : "Re-sign now"}
      </button>
    </div>
  );
}
