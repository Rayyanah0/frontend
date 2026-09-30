/**
 * /stats/embed — iframe-safe embeddable stats widget.
 *
 * Renders without the nav shell. The Next.js middleware (or a custom
 * response header at the CDN/edge) should set:
 *
 *   Content-Security-Policy: frame-ancestors 'self' https://trusted-partner.com
 *
 * scoped **only** to routes under /stats/embed, so the rest of the app
 * keeps the default restrictive frame-ancestors policy.
 *
 * This page is intentionally minimal: KPI tiles + TVL sparkline only,
 * so it fits in a standard 700×420 iframe without scrollbars.
 */
"use client";

import { useEffect, useState } from "react";
import { getProtocolStats, MOCK_STATS, type ProtocolStats } from "../../../../lib/api/stats";

function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function StatsEmbedPage() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [isMock, setIsMock] = useState(false);

  useEffect(() => {
    getProtocolStats()
      .then(s => setStats(s))
      .catch(() => { setStats(MOCK_STATS); setIsMock(true); });
  }, []);

  const kpis = stats
    ? [
        { label: "TVL",            value: fmtUSD(stats.tvl.value),                  pct: stats.tvl.change_24h_pct },
        { label: "Open Interest",  value: fmtUSD(stats.open_interest.value),         pct: stats.open_interest.change_24h_pct },
        { label: "Volume 24h",     value: fmtUSD(stats.notional_volume_24h.value),   pct: stats.notional_volume_24h.change_24h_pct },
        { label: "Traders 24h",    value: String(Math.round(stats.active_traders_24h.value)), pct: stats.active_traders_24h.change_24h_pct },
        { label: "Put/Call",       value: stats.put_call_ratio.value.toFixed(2),     pct: stats.put_call_ratio.change_24h_pct },
        { label: "Fees 24h",       value: fmtUSD(stats.fees_24h.value),              pct: stats.fees_24h.change_24h_pct },
      ]
    : [];

  return (
    <div style={{ background: "var(--bg)", fontFamily: "var(--font-sans)", color: "var(--text-hi)", padding: "20px", width: 700, minHeight: 420 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-serif)", color: "var(--text-hi)" }}>
          Zenith Protocol · Analytics
        </div>
        {isMock && (
          <span style={{ fontSize: 9, padding: "2px 6px", background: "var(--atm-dim)", color: "var(--atm)" }}>Mock</span>
        )}
        <a href="/stats" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "var(--brand)", textDecoration: "none" }}>
          Full dashboard ↗
        </a>
      </div>

      {!stats ? (
        <div style={{ textAlign: "center", padding: "60px 0", fontSize: 12, color: "var(--text-lo)" }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {kpis.map(k => (
            <div key={k.label} style={{ padding: "12px 14px", border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6 }}>{k.label}</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 700, color: "var(--text-hi)", marginBottom: 4 }}>{k.value}</div>
              <div className="num" style={{ fontSize: 10, fontWeight: 600, color: k.pct >= 0 ? "var(--call)" : "var(--put)" }}>
                {fmtPct(k.pct)} 24h
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
