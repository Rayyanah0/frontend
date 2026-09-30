"use client";

import { useEffect, useState } from "react";
import { env } from "../env";
import { getRuntimeConfig } from "../lib/api/client";

export function AboutPanel() {
  const [network, setNetwork] = useState(env.NEXT_PUBLIC_STELLAR_NETWORK);

  useEffect(() => {
    void getRuntimeConfig().then((config) => setNetwork(config.network)).catch(() => undefined);
  }, []);

  return (
    <details style={{ position: "relative", marginLeft: "auto" }}>
      <summary style={{
        cursor: "pointer", listStyle: "none", fontSize: 11, fontWeight: 600,
        color: "var(--text-mid)", padding: "6px 8px",
      }}>
        About
      </summary>
      <div style={{
        position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 100,
        width: 260, padding: 14, background: "var(--bg-raised)",
        border: "1px solid var(--border-default)", boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-hi)", marginBottom: 10 }}>
          Zenith Options
        </div>
        <dl style={{ display: "grid", gridTemplateColumns: "70px minmax(0, 1fr)", gap: "7px 8px", margin: 0 }}>
          <dt style={{ fontSize: 10, color: "var(--text-lo)" }}>Version</dt>
          <dd className="num" style={{ fontSize: 10, color: "var(--text-mid)", margin: 0 }}>
            {env.NEXT_PUBLIC_APP_VERSION}
          </dd>
          <dt style={{ fontSize: 10, color: "var(--text-lo)" }}>Build SHA</dt>
          <dd className="num" title={env.NEXT_PUBLIC_BUILD_SHA} style={{
            fontSize: 10, color: "var(--text-mid)", margin: 0, overflowWrap: "anywhere",
          }}>
            {env.NEXT_PUBLIC_BUILD_SHA}
          </dd>
          <dt style={{ fontSize: 10, color: "var(--text-lo)" }}>Network</dt>
          <dd style={{ fontSize: 10, color: "var(--text-mid)", margin: 0, textTransform: "capitalize" }}>
            {network}
          </dd>
        </dl>
      </div>
    </details>
  );
}