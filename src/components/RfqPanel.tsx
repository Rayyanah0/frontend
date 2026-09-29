/**
 * RfqPanel — Issue #65.
 *
 * Taker-side RFQ workflow:
 * 1. Form to define structure (strategy legs reused from strategy builder),
 *    size, and optional limit price.
 * 2. Live quote board: incoming quotes stream in with countdown timer,
 *    best quote highlighted, model price comparison.
 * 3. Lifecycle states: draft → requested → quoting → accepted/expired/cancelled.
 * 4. History of past RFQs.
 *
 * Gated by NEXT_PUBLIC_ENABLE_RFQ_MOCK feature flag.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MARKETS, EXPIRIES, bs, smileVol, fmtN } from "../lib/pricing";
import { STRATEGY_TEMPLATES, type StrategyTemplate } from "../lib/strategies";
import { netPremium, type PricedLeg } from "../lib/payoff";
import { strategyLegsToRfqLegs } from "../lib/rfq/types";
import { useRfq } from "../lib/rfq/useRfq";
import type { MakerQuote, RfqRecord } from "../lib/rfq/types";

const STATUS_COLORS: Record<string, string> = {
  draft:     "var(--text-lo)",
  requested: "var(--atm)",
  quoting:   "var(--brand)",
  accepted:  "var(--call)",
  expired:   "var(--put)",
  cancelled: "var(--text-lo)",
};

const STATUS_LABELS: Record<string, string> = {
  draft:     "Draft",
  requested: "Requested",
  quoting:   "Live Quotes",
  accepted:  "Accepted",
  expired:   "Expired",
  cancelled: "Cancelled",
};

function fmtCountdown(expiresAt: number): string {
  const ms = Math.max(0, expiresAt - Date.now());
  const s = Math.ceil(ms / 1000);
  return `${s}s`;
}

interface Props {
  sym: string;
  spot: number;
  vol: number;
}

export function RfqPanel({ sym, spot, vol }: Props) {
  const {
    enabled, activeRfq, history, loading, error,
    submitRfq, acceptQuote, cancelRfq, clearActive,
  } = useRfq();

  const [selectedTemplate, setSelectedTemplate] = useState<StrategyTemplate | null>(null);
  const [contracts, setContracts] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const [view, setView] = useState<"form" | "active" | "history">("form");
  const [countdown, setCountdown] = useState<string>("");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep countdown ticking for the active RFQ's quote window
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (activeRfq?.quoteWindowExpiresAt && activeRfq.status === "quoting") {
      const expiresAt = activeRfq.quoteWindowExpiresAt;
      setCountdown(fmtCountdown(expiresAt));
      tickRef.current = setInterval(() => {
        setCountdown(fmtCountdown(expiresAt));
      }, 250);
    } else {
      setCountdown("");
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRfq?.quoteWindowExpiresAt, activeRfq?.status]);

  // Switch to active view when an RFQ is live
  useEffect(() => {
    if (activeRfq && ["requested", "quoting"].includes(activeRfq.status)) {
      setView("active");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRfq?.status]);

  // Compute model price using local BS
  const modelPrice = useMemo(() => {
    if (!selectedTemplate) return 0;
    const legs: PricedLeg[] = selectedTemplate.legs.map(l => {
      const k = spot * l.strikeOffset;
      const t = EXPIRIES[2].days / 365;
      const v = smileVol(vol, k / spot);
      const g = bs(spot, k, v, t, l.side === "call");
      return { side: l.side, action: l.action, strike: k, contracts: 1, greeks: g };
    });
    // Net cost for the taker (positive = debit)
    return Math.abs(netPremium(legs));
  }, [selectedTemplate, spot, vol]);

  const handleSubmit = useCallback(async () => {
    if (!selectedTemplate) return;
    const c = parseInt(contracts) || 1;
    const lp = limitPrice ? parseFloat(limitPrice) : null;
    const rfqLegs = strategyLegsToRfqLegs(selectedTemplate.legs, spot, c);
    await submitRfq({
      underlying: sym,
      legs: rfqLegs,
      totalContracts: c,
      limitPrice: lp,
      modelPrice,
    });
  }, [selectedTemplate, contracts, limitPrice, sym, spot, modelPrice, submitRfq]);

  if (!enabled) {
    return (
      <div style={{
        padding: 20, border: "1px solid var(--border-default)",
        background: "var(--bg-raised)", color: "var(--text-lo)", fontSize: 12,
      }}>
        RFQ is disabled. Set{" "}
        <code style={{ fontFamily: "var(--font-mono)", color: "var(--brand)" }}>
          NEXT_PUBLIC_ENABLE_RFQ_MOCK=true
        </code>{" "}
        to enable the mock RFQ workflow.
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 16px", borderBottom: "1px solid var(--border-default)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>RFQ</span>
          <span style={{
            fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em",
            padding: "2px 6px", background: "var(--brand-dim)", color: "var(--brand)",
          }}>
            Beta
          </span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {(["form", "active", "history"] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              style={{
                padding: "3px 10px", border: "none", cursor: "pointer", fontSize: 11,
                background: view === v ? "var(--atm-dim)" : "transparent",
                color: view === v ? "var(--atm)" : "var(--text-lo)",
              }}
            >
              {v === "form" ? "New RFQ" : v === "active" ? `Live${activeRfq ? " ●" : ""}` : `History (${history.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Form ── */}
      {view === "form" && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Strategy picker */}
          <div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", marginBottom: 6 }}>
              Structure
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {STRATEGY_TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => setSelectedTemplate(tmpl)}
                  aria-pressed={selectedTemplate?.id === tmpl.id}
                  style={{
                    padding: "8px 12px", border: "1px solid",
                    borderColor: selectedTemplate?.id === tmpl.id ? "var(--brand)" : "var(--border-default)",
                    background: selectedTemplate?.id === tmpl.id ? "var(--brand-dim)" : "var(--bg-elevated)",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: selectedTemplate?.id === tmpl.id ? "var(--brand)" : "var(--text-hi)" }}>
                    {tmpl.name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 2 }}>
                    {tmpl.legs.map(l => `${l.action === "buy" ? "+" : "−"}${l.side.toUpperCase()} @${(l.strikeOffset * 100).toFixed(0)}%`).join("  ·  ")}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedTemplate && (
            <>
              {/* Resolved legs preview */}
              <div style={{ border: "1px solid var(--border-subtle)", padding: 10 }}>
                <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 6 }}>
                  Resolved legs for {sym} @ {spot < 10 ? spot.toFixed(4) : spot.toFixed(2)}
                </div>
                {selectedTemplate.legs.map((l, i) => {
                  const k = spot * l.strikeOffset;
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, padding: "2px 0" }}>
                      <span style={{ color: l.action === "buy" ? "var(--call)" : "var(--put)", width: 32 }}>
                        {l.action === "buy" ? "BUY" : "SELL"}
                      </span>
                      <span style={{ color: l.side === "call" ? "var(--call)" : "var(--put)" }}>
                        {l.side.toUpperCase()}
                      </span>
                      <span className="num" style={{ color: "var(--text-hi)" }}>
                        K={k < 1 ? k.toFixed(4) : k.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border-subtle)", fontSize: 11 }}>
                  <span style={{ color: "var(--text-lo)" }}>Model price: </span>
                  <span className="num" style={{ color: "var(--atm)" }}>${fmtN(modelPrice, 4)}</span>
                </div>
              </div>

              {/* Size + limit */}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>
                    Contracts
                  </label>
                  <input
                    type="number" min="1" value={contracts}
                    onChange={e => setContracts(e.target.value)}
                    aria-label="Number of contracts"
                    style={{
                      width: "100%", padding: "6px 8px", background: "var(--bg-elevated)",
                      border: "1px solid var(--border-default)", color: "var(--text-hi)",
                      fontSize: 12, fontFamily: "var(--font-mono)", outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>
                    Limit Price (optional)
                  </label>
                  <input
                    type="number" placeholder="No limit" value={limitPrice}
                    onChange={e => setLimitPrice(e.target.value)}
                    aria-label="Optional limit price"
                    style={{
                      width: "100%", padding: "6px 8px", background: "var(--bg-elevated)",
                      border: "1px solid var(--border-default)", color: "var(--text-hi)",
                      fontSize: 12, fontFamily: "var(--font-mono)", outline: "none",
                    }}
                  />
                </div>
              </div>

              {error && (
                <div style={{ padding: "8px 10px", background: "var(--put-dim)", color: "var(--put)", fontSize: 11 }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading}
                aria-busy={loading}
                style={{
                  padding: "10px 0", border: "none", cursor: loading ? "not-allowed" : "pointer",
                  background: "var(--brand)", color: "var(--bg)", fontSize: 12, fontWeight: 700,
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? "Submitting…" : "Request Quotes"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Live quote board ── */}
      {view === "active" && (
        <div style={{ padding: 16 }}>
          {!activeRfq ? (
            <div style={{ color: "var(--text-lo)", fontSize: 12 }}>No active RFQ. Submit one from the New RFQ tab.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Status bar */}
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.08em", color: STATUS_COLORS[activeRfq.status],
                }}>
                  {STATUS_LABELS[activeRfq.status]}
                </span>
                {countdown && (
                  <span className="num" style={{ fontSize: 11, color: "var(--atm)" }}>
                    Window: {countdown}
                  </span>
                )}
                <span style={{ fontSize: 10, color: "var(--text-lo)", marginLeft: "auto" }}>
                  {activeRfq.underlying} · {activeRfq.totalContracts} contract{activeRfq.totalContracts !== 1 ? "s" : ""}
                </span>
                {["requested", "quoting"].includes(activeRfq.status) && (
                  <button
                    onClick={cancelRfq}
                    aria-label="Cancel RFQ"
                    style={{
                      padding: "2px 8px", border: "1px solid var(--put)", background: "transparent",
                      color: "var(--put)", cursor: "pointer", fontSize: 10,
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {/* Legs summary */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {activeRfq.legs.map((l, i) => (
                  <span key={i} style={{
                    fontSize: 10, padding: "2px 8px",
                    background: l.action === "buy" ? "var(--call-dim)" : "var(--put-dim)",
                    color: l.action === "buy" ? "var(--call)" : "var(--put)",
                  }}>
                    {l.action === "buy" ? "+" : "−"}{l.side.toUpperCase()} K={l.strike < 1 ? l.strike.toFixed(4) : l.strike.toFixed(2)}
                  </span>
                ))}
              </div>

              {/* Model price reference */}
              <div style={{ fontSize: 11, color: "var(--text-lo)" }}>
                Model price:{" "}
                <span className="num" style={{ color: "var(--atm)" }}>
                  ${fmtN(activeRfq.modelPrice, 4)}
                </span>
                {activeRfq.limitPrice && (
                  <span>
                    {" "}· Limit:{" "}
                    <span className="num" style={{ color: "var(--brand)" }}>
                      ${fmtN(activeRfq.limitPrice, 4)}
                    </span>
                  </span>
                )}
              </div>

              {/* Quote table */}
              {activeRfq.quotes.length === 0 && activeRfq.status === "quoting" && (
                <div style={{ color: "var(--text-lo)", fontSize: 12, padding: "12px 0" }}>
                  Waiting for maker quotes…
                </div>
              )}

              {activeRfq.quotes.length > 0 && (
                <div style={{ border: "1px solid var(--border-default)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-default)", background: "var(--bg-elevated)" }}>
                        {["Maker", "Price", "Fillable", "vs Model", "Expires", ""].map(h => (
                          <th key={h} style={{
                            padding: "5px 10px", textAlign: h === "" ? "right" : "left",
                            fontSize: 10, fontWeight: 500, textTransform: "uppercase",
                            letterSpacing: "0.05em", color: "var(--text-lo)",
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...activeRfq.quotes].sort((a, b) => a.price - b.price).map(q => {
                        const vsModel = ((q.price - activeRfq.modelPrice) / activeRfq.modelPrice) * 100;
                        const isAccepted = activeRfq.acceptedQuote?.id === q.id;
                        return (
                          <tr
                            key={q.id}
                            style={{
                              background: q.isBest && activeRfq.status === "quoting"
                                ? "var(--call-dim)"
                                : isAccepted ? "var(--brand-dim)" : "transparent",
                              borderBottom: "1px solid var(--border-subtle)",
                            }}
                          >
                            <td style={{ padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-mid)" }}>
                              {q.maker}
                              {q.isBest && activeRfq.status === "quoting" && (
                                <span style={{ marginLeft: 6, fontSize: 9, color: "var(--call)", fontWeight: 700 }}>BEST</span>
                              )}
                            </td>
                            <td className="num" style={{ padding: "6px 10px", color: "var(--text-hi)", fontWeight: 600 }}>
                              ${fmtN(q.price, 4)}
                            </td>
                            <td className="num" style={{ padding: "6px 10px", color: "var(--text-mid)" }}>
                              {q.fillable}
                            </td>
                            <td className="num" style={{
                              padding: "6px 10px",
                              color: vsModel <= 0 ? "var(--call)" : "var(--put)",
                            }}>
                              {vsModel >= 0 ? "+" : ""}{vsModel.toFixed(1)}%
                            </td>
                            <td className="num" style={{ padding: "6px 10px", color: "var(--text-lo)", fontSize: 10 }}>
                              <QuoteCountdown expiresAt={q.expiresAt} />
                            </td>
                            <td style={{ padding: "6px 10px", textAlign: "right" }}>
                              {activeRfq.status === "quoting" && !isAccepted && (
                                <button
                                  onClick={() => acceptQuote(q.id)}
                                  aria-label={`Accept quote from ${q.maker}`}
                                  style={{
                                    padding: "3px 10px", border: "1px solid var(--call)",
                                    background: "transparent", color: "var(--call)",
                                    cursor: "pointer", fontSize: 10,
                                  }}
                                >
                                  Accept
                                </button>
                              )}
                              {isAccepted && (
                                <span style={{ fontSize: 10, color: "var(--brand)", fontWeight: 600 }}>✓ Accepted</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Terminal state actions */}
              {["accepted", "expired", "cancelled"].includes(activeRfq.status) && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { clearActive(); setView("form"); }}
                    style={{
                      padding: "6px 14px", border: "1px solid var(--border-default)",
                      background: "transparent", color: "var(--text-mid)",
                      cursor: "pointer", fontSize: 11,
                    }}
                  >
                    New RFQ
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {view === "history" && (
        <div style={{ padding: 16 }}>
          {history.length === 0 ? (
            <div style={{ color: "var(--text-lo)", fontSize: 12 }}>No RFQ history yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {history.map(rfq => (
                <div
                  key={rfq.id}
                  style={{
                    display: "flex", gap: 12, alignItems: "center",
                    padding: "8px 10px", border: "1px solid var(--border-subtle)",
                    background: "var(--bg-elevated)", fontSize: 11,
                  }}
                >
                  <span style={{
                    fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.06em", color: STATUS_COLORS[rfq.status],
                    minWidth: 64,
                  }}>
                    {STATUS_LABELS[rfq.status]}
                  </span>
                  <span style={{ color: "var(--text-mid)" }}>{rfq.underlying}</span>
                  <span style={{ color: "var(--text-lo)" }}>{rfq.legs.length} leg{rfq.legs.length !== 1 ? "s" : ""}</span>
                  <span className="num" style={{ color: "var(--text-lo)" }}>×{rfq.totalContracts}</span>
                  {rfq.acceptedQuote && (
                    <span className="num" style={{ color: "var(--call)" }}>
                      ${fmtN(rfq.acceptedQuote.price, 4)} via {rfq.acceptedQuote.maker}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-lo)", fontFamily: "var(--font-mono)" }}>
                    {new Date(rfq.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Isolated countdown cell so it re-renders on its own interval */
function QuoteCountdown({ expiresAt }: { expiresAt: number }) {
  const [label, setLabel] = useState(() => fmtCountdown(expiresAt));
  useEffect(() => {
    const t = setInterval(() => setLabel(fmtCountdown(expiresAt)), 500);
    return () => clearInterval(t);
  }, [expiresAt]);
  return <>{label}</>;
}
