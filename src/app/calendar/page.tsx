"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { useBackendData } from "../../lib/context/BackendDataContext";
import { useSpotFeedContext } from "../../lib/context/SpotFeedContext";
import { useWalletStore } from "../../lib/store/wallet";
import { MARKETS, fmtN, fmtK } from "../../lib/pricing";
import {
  buildIcsFeed,
  buildSettlementCenter,
  countdownLabel,
  daysRemaining,
  downloadIcs,
  dueExpiryNotifications,
  groupByExpiryDate,
} from "../../lib/expiry";
import {
  loadInAppToasts,
  notifyBoth,
  notificationPermission,
  requestNotificationPermission,
  type InAppToast,
} from "../../lib/notify";

const NOTIFIED_KEY = "zenith.expiryNotified";

type ViewMode = "month" | "list";

function loadNotified(): Record<string, { h24?: boolean; h1?: boolean }> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveNotified(m: Record<string, { h24?: boolean; h1?: boolean }>) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(m));
}

export default function CalendarPage() {
  const token = useWalletStore(s => s.token);
  const { positions: openPositions } = useBackendData();
  const { data: spotFeed } = useSpotFeedContext();
  const spots = spotFeed?.prices ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.price]));

  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
  });
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  const [perm, setPerm] = useState<string>("default");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setToasts(loadInAppToasts());
    setPerm(notificationPermission());
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<InAppToast>).detail;
      setToasts(prev => [detail, ...prev].slice(0, 20));
    };
    window.addEventListener("zenith:toast", onToast);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener("zenith:toast", onToast);
      clearInterval(tick);
    };
  }, []);

  // Opt-in expiry reminders (24h / 1h).
  useEffect(() => {
    if (!token) return;
    const notified = loadNotified();
    const due = dueExpiryNotifications(openPositions, notified, now);
    if (due.length === 0) return;
    for (const d of due) {
      const title = d.kind === "1h" ? "Expiry in under 1 hour" : "Expiry within 24 hours";
      const body = `${d.position.underlying} ${d.position.position_type} ${d.position.option_type} K=${d.position.strike}`;
      notifyBoth(title, body);
      const flags = notified[d.position.id] ?? {};
      if (d.kind === "1h") flags.h1 = true;
      else flags.h24 = true;
      notified[d.position.id] = flags;
    }
    saveNotified(notified);
  }, [openPositions, now, token]);

  const groups = useMemo(() => groupByExpiryDate(openPositions, spots), [openPositions, spots]);
  const settlement = useMemo(
    () => buildSettlementCenter(openPositions, spots, now),
    [openPositions, spots, now]
  );

  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const monthLabel = cursor.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const calendarCells = useMemo(() => {
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const byDate = new Map(groups.map(g => [g.date, g]));
    const cells: { date: string | null; group: ReturnType<typeof groupByExpiryDate>[0] | null }[] = [];
    for (let i = 0; i < firstDow; i++) cells.push({ date: null, group: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date: key, group: byDate.get(key) ?? null });
    }
    return cells;
  }, [year, month, groups]);

  const enableNotifs = () => {
    requestNotificationPermission();
    setTimeout(() => setPerm(notificationPermission()), 500);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
      <AppHeader>
        <div style={{ marginLeft: "auto" }}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 64px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Expiry Calendar</h1>
              <p style={{ fontSize: 13, color: "var(--text-mid)" }}>
                {!token
                  ? "Connect your wallet to see upcoming expiries."
                  : "Upcoming expiries, countdowns, and settlement outcomes. Expiry timestamps: opened_at + expiry_days (UTC 08:00) unless backend ExpiryInfo.timestamp is provided."}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                aria-label="Enable browser expiry notifications"
                onClick={enableNotifs}
                style={{
                  fontSize: 11, padding: "6px 10px", cursor: "pointer",
                  background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-mid)",
                }}
              >
                Notifications: {perm}
              </button>
              <button
                aria-label="Download ICS calendar feed of expiries"
                onClick={() => downloadIcs(`zenith-expiries.ics`, buildIcsFeed(openPositions))}
                disabled={openPositions.length === 0}
                style={{
                  fontSize: 11, padding: "6px 10px", cursor: openPositions.length ? "pointer" : "default",
                  background: "var(--brand)", border: "none", color: "var(--bg)", fontWeight: 600,
                  opacity: openPositions.length ? 1 : 0.5,
                }}
              >
                Download .ics
              </button>
            </div>
          </div>

          {toasts.length > 0 && (
            <div style={{ marginBottom: 16, border: "1px solid var(--atm)", background: "var(--atm-dim)", padding: "10px 14px" }} role="status" aria-label="In-app expiry notifications">
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--atm)", marginBottom: 6 }}>In-app alerts</div>
              {toasts.slice(0, 3).map(t => (
                <div key={t.id} style={{ fontSize: 12, color: "var(--text-hi)", marginBottom: 4 }}>
                  <strong>{t.title}</strong> — {t.body}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 2, marginBottom: 16 }} role="tablist" aria-label="Calendar view mode">
            {(["month", "list"] as ViewMode[]).map(v => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                aria-label={`${v} view`}
                onClick={() => setView(v)}
                style={{
                  padding: "6px 14px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, textTransform: "capitalize",
                  background: view === v ? "var(--atm-dim)" : "transparent",
                  color: view === v ? "var(--atm)" : "var(--text-lo)",
                }}
              >
                {v}
              </button>
            ))}
          </div>

          {view === "month" ? (
            <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", marginBottom: 32 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border-default)" }}>
                <button
                  aria-label="Previous month"
                  onClick={() => setCursor(new Date(Date.UTC(year, month - 1, 1)))}
                  style={{ background: "none", border: "1px solid var(--border-default)", color: "var(--text-mid)", padding: "4px 10px", cursor: "pointer" }}
                >
                  ←
                </button>
                <div style={{ fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 600 }}>{monthLabel}</div>
                <button
                  aria-label="Next month"
                  onClick={() => setCursor(new Date(Date.UTC(year, month + 1, 1)))}
                  style={{ background: "none", border: "1px solid var(--border-default)", color: "var(--text-mid)", padding: "4px 10px", cursor: "pointer" }}
                >
                  →
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border-subtle)" }}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
                  <div key={d} style={{ padding: "6px", fontSize: 10, textAlign: "center", color: "var(--text-lo)", textTransform: "uppercase" }}>{d}</div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                {calendarCells.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      minHeight: 72, padding: 8, borderRight: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)",
                      background: c.group ? "var(--brand-dim)" : "transparent", opacity: c.date ? 1 : 0.3,
                    }}
                  >
                    {c.date && (
                      <>
                        <div className="num" style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 4 }}>{Number(c.date.slice(-2))}</div>
                        {c.group && (
                          <div style={{ fontSize: 10, color: "var(--text-hi)" }}>
                            {c.group.count} pos · ${fmtN(c.group.netPremium, 2)}
                            <div className="num" style={{ color: "var(--atm)", marginTop: 2 }}>{countdownLabel(c.group.expiryMs, now)}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", marginBottom: 32 }}>
              {groups.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--text-lo)", fontSize: 13 }}>No upcoming expiries</div>
              ) : (
                groups.map(g => {
                  const rem = daysRemaining(g.expiryMs, now);
                  const urgent = rem <= 1;
                  return (
                    <div key={g.date} style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)" }}>{g.date} UTC</div>
                        <span
                          aria-label={`Countdown ${countdownLabel(g.expiryMs, now)}`}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: "2px 8px",
                            background: urgent ? "var(--put-dim)" : "var(--atm-dim)",
                            color: urgent ? "var(--put)" : "var(--atm)",
                          }}
                        >
                          {countdownLabel(g.expiryMs, now)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 8 }}>
                        {g.count} positions · net premium ${fmtN(g.netPremium, 2)} · projected intrinsic ${fmtN(g.projectedIntrinsic, 2)}
                      </div>
                      {g.positions.map(p => (
                        <div key={p.id} style={{ display: "flex", gap: 12, fontSize: 11, padding: "2px 0", color: "var(--text-mid)" }}>
                          <span style={{ color: "var(--text-hi)", fontWeight: 600 }}>{p.underlying}</span>
                          <span>{p.position_type} {p.option_type}</span>
                          <span className="num">K={fmtK(p.strike)}</span>
                          <span className="num">{p.contracts}×</span>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          )}

          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Settlement Center</h2>
          <p style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 12 }}>
            Expired positions with ITM/OTM outcome. On-chain claim flows are out of scope — rows marked “action required” need manual close.
          </p>

          <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", overflowX: "auto" }}>
            {settlement.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-lo)", fontSize: 13 }}>No settled or expired positions</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                    {["Expiry", "Asset", "Side", "Strike", "Outcome", "Settle px", "Realized P&L", "Action"].map(h => (
                      <th key={h} style={{ padding: "8px 10px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-overlay)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {settlement.map(row => (
                    <tr key={row.position.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td className="num" style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-mid)" }}>{new Date(row.expiryMs).toISOString().slice(0, 10)}</td>
                      <td style={{ padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{row.position.underlying}</td>
                      <td style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-mid)", textTransform: "uppercase" }}>{row.position.position_type} {row.position.option_type}</td>
                      <td className="num" style={{ padding: "8px 10px", fontSize: 11, textAlign: "right" }}>{fmtK(row.position.strike)}</td>
                      <td style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", color: row.outcome === "ITM" ? "var(--call)" : "var(--text-mid)" }}>{row.outcome}</td>
                      <td className="num" style={{ padding: "8px 10px", fontSize: 11, textAlign: "right" }}>${fmtN(row.settlementPrice, 4)}</td>
                      <td className="num" style={{ padding: "8px 10px", fontSize: 11, textAlign: "right", color: row.realizedPnl >= 0 ? "var(--call)" : "var(--put)" }}>
                        {row.realizedPnl >= 0 ? "+" : "−"}${fmtN(Math.abs(row.realizedPnl), 2)}
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 11, textAlign: "right" }}>
                        {row.actionRequired ? (
                          <Link href="/portfolio" style={{ color: "var(--brand)", textDecoration: "none" }}>Close →</Link>
                        ) : (
                          <span style={{ color: "var(--text-lo)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
