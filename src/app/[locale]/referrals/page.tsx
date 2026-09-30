"use client";

/**
 * Issue #94 — Referral Program UI
 *
 * - Referral code generation tied to the connected wallet.
 * - Shareable link with copy-to-clipboard and a text-based QR hint.
 * - Attribution capture: reads ?ref= from the URL on first load and stores it
 *   in sessionStorage until the wallet connects, then registers it with the
 *   backend (first-touch, ignores self-referral on the server side).
 * - Dashboard: referee count, aggregate volume, rewards by period, claimable.
 * - Claim flow with tx-hash confirmation.
 */

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "../../../components/AppHeader";
import { WalletConnect } from "../../../components/WalletConnect";
import { useWalletStore } from "../../../lib/store/wallet";
import { useHydrated } from "../../../lib/useHydrated";
import {
  getReferralCode,
  getReferralDashboard,
  registerAttribution,
  claimRewards,
  type ReferralDashboard,
  type ReferralCode,
} from "../../../lib/api/referrals";

const REF_STORAGE_KEY = "zenith_ref_pending";

/** Validate referral code format: 8–32 alphanumeric chars. */
function isValidCode(code: string): boolean {
  return /^[A-Za-z0-9]{8,32}$/.test(code);
}

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Attribution capture (first-touch, privacy-respecting) ──────────────────
// Runs on every page load. If a ?ref= param is present and valid, we store it
// in sessionStorage so it survives a redirect to the connect-wallet flow.
// It is never written if the user has opted out (localStorage flag).
function captureAttributionFromUrl(searchParams: URLSearchParams) {
  const code = searchParams.get("ref");
  if (!code) return;
  if (!isValidCode(code)) return;
  try {
    if (localStorage.getItem("zenith_ref_opt_out") === "1") return;
    // Only store if nothing is already set (first-touch).
    if (!sessionStorage.getItem(REF_STORAGE_KEY)) {
      sessionStorage.setItem(REF_STORAGE_KEY, code);
    }
  } catch {
    // Storage not available — skip silently.
  }
}

function ReferralsContent() {
  const hydrated = useHydrated();
  const token = useWalletStore(s => s.session);
  const wallet = useWalletStore(s => s.address);
  const searchParams = useSearchParams();

  const [referralCode, setReferralCode] = useState<ReferralCode | null>(null);
  const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [optedOut, setOptedOut] = useState(false);

  // ── Capture ?ref= on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    captureAttributionFromUrl(searchParams as unknown as URLSearchParams);
    try {
      setOptedOut(localStorage.getItem("zenith_ref_opt_out") === "1");
    } catch { /* ignore */ }
  }, [hydrated, searchParams]);

  // ── Register pending attribution once wallet is connected ───────────────
  useEffect(() => {
    if (!token || !hydrated) return;
    try {
      const pending = sessionStorage.getItem(REF_STORAGE_KEY);
      if (!pending || !isValidCode(pending)) return;
      // Fire-and-forget: the backend is idempotent and ignores self-referral.
      registerAttribution(pending, token)
        .then(() => sessionStorage.removeItem(REF_STORAGE_KEY))
        .catch(() => {/* non-critical */});
    } catch { /* storage unavailable */ }
  }, [token, hydrated]);

  // ── Load referral code + dashboard ────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [code, dash] = await Promise.all([
        getReferralCode(token),
        getReferralDashboard(token),
      ]);
      setReferralCode(code);
      setDashboard(dash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load referral data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (hydrated && token) loadData(); }, [hydrated, token, loadData]);

  // ── Clipboard ──────────────────────────────────────────────────────────
  const copyLink = () => {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Claim ──────────────────────────────────────────────────────────────
  const handleClaim = async () => {
    if (!token || !dashboard || dashboard.rewards_claimable <= 0) return;
    setClaimLoading(true);
    setError(null);
    try {
      const result = await claimRewards(token);
      setClaimTx(result.tx_hash);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setClaimLoading(false);
    }
  };

  // ── Opt-out toggle ─────────────────────────────────────────────────────
  const toggleOptOut = () => {
    try {
      if (optedOut) {
        localStorage.removeItem("zenith_ref_opt_out");
        setOptedOut(false);
      } else {
        localStorage.setItem("zenith_ref_opt_out", "1");
        sessionStorage.removeItem(REF_STORAGE_KEY);
        setOptedOut(true);
      }
    } catch { /* storage unavailable */ }
  };

  const notConnected = !hydrated || !token;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
      <AppHeader>
        <div style={{ marginLeft: "auto" }}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 64px" }}>

          {/* Page header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 6 }}>
              Community
            </div>
            <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 6 }}>
              Referral Program
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-mid)" }}>
              Invite traders to Zenith. Earn rewards based on their trading volume.
              {notConnected && " Connect your wallet to get your referral link."}
            </p>
          </div>

          {notConnected && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", border: "1px solid var(--border-subtle)", background: "var(--bg-raised)", gap: 12 }}>
              <div style={{ fontSize: 14, color: "var(--text-mid)" }}>Connect your wallet to access the referral program</div>
              <WalletConnect />
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
              {error}
            </div>
          )}

          {claimTx && (
            <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--call)", background: "var(--call-dim)", fontSize: 12, color: "var(--call)" }}>
              Rewards claimed successfully. Transaction: <span style={{ fontFamily: "var(--font-mono)" }}>{claimTx}</span>
            </div>
          )}

          {loading && !dashboard && (
            <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--text-lo)" }}>
              Loading…
            </div>
          )}

          {!notConnected && !loading && referralCode && dashboard && (
            <>
              {/* ── Your referral link ─────────────────────────────────── */}
              <div style={{ marginBottom: 24, border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "20px 24px" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 12 }}>
                  Your Referral Link
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-hi)", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", padding: "8px 12px", wordBreak: "break-all", minWidth: 200 }}>
                    {referralCode.link}
                  </div>
                  <button
                    onClick={copyLink}
                    style={{ padding: "8px 16px", background: copied ? "var(--call-dim)" : "var(--brand)", color: copied ? "var(--call)" : "var(--bg)", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {copied ? "Copied!" : "Copy Link"}
                  </button>
                </div>

                <div style={{ marginTop: 16, display: "flex", gap: 24, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 2 }}>Referral Code</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: "var(--brand)", letterSpacing: "0.08em" }}>
                      {referralCode.code}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 2 }}>Active Since</div>
                    <div style={{ fontSize: 13, color: "var(--text-mid)" }}>{fmtDate(referralCode.created_at)}</div>
                  </div>
                </div>

                {/* QR code placeholder — renders a styled ASCII-art hint */}
                <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--bg-overlay)", border: "1px solid var(--border-subtle)", display: "inline-block" }}>
                  <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-lo)", lineHeight: 1.4 }}>
                    {["██████████████", "██  ██    ████", "██ ████ ██ ███", "██  ██  ██  ██", "██████████████"].map((row, i) => (
                      <div key={i}>{row}</div>
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-lo)", marginTop: 4, textAlign: "center" }}>QR · {referralCode.code}</div>
                </div>
              </div>

              {/* ── Summary stats ─────────────────────────────────────────── */}
              <div style={{ display: "flex", gap: 0, marginBottom: 24, border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
                {[
                  { label: "Total Referees", value: String(dashboard.total_referees), color: "var(--text-hi)" },
                  { label: "Aggregate Volume", value: `$${fmtUSD(dashboard.total_volume)}`, color: "var(--text-hi)" },
                  { label: "Rewards Earned", value: `$${fmtUSD(dashboard.rewards_earned)}`, color: "var(--atm)" },
                  { label: "Claimable Now", value: `$${fmtUSD(dashboard.rewards_claimable)}`, color: dashboard.rewards_claimable > 0 ? "var(--call)" : "var(--text-lo)" },
                ].map((s, i) => (
                  <div key={s.label} style={{ flex: 1, padding: "14px 18px", borderRight: i < 3 ? "1px solid var(--border-default)" : "none" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6 }}>{s.label}</div>
                    <div className="num" style={{ fontSize: 17, fontWeight: 600, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* ── Claim button ──────────────────────────────────────────── */}
              <div style={{ marginBottom: 32, display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={handleClaim}
                  disabled={claimLoading || dashboard.rewards_claimable <= 0}
                  style={{
                    padding: "10px 24px",
                    background: dashboard.rewards_claimable > 0 ? "var(--brand)" : "var(--bg-overlay)",
                    color: dashboard.rewards_claimable > 0 ? "var(--bg)" : "var(--text-lo)",
                    border: "none",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: claimLoading || dashboard.rewards_claimable <= 0 ? "default" : "pointer",
                    opacity: claimLoading ? 0.6 : 1,
                  }}
                >
                  {claimLoading ? "Claiming…" : `Claim $${fmtUSD(dashboard.rewards_claimable)}`}
                </button>
                {dashboard.rewards_claimable <= 0 && (
                  <span style={{ fontSize: 12, color: "var(--text-lo)" }}>No claimable rewards yet</span>
                )}
              </div>

              {/* ── Period stats table ────────────────────────────────────── */}
              {dashboard.period_stats.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 10 }}>
                    Rewards by Period
                  </div>
                  <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                          {["Period", "Referees", "Volume", "Rewards Earned"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-overlay)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.period_stats.map(row => (
                          <tr key={row.period} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-hi)" }}>{row.period}</td>
                            <td className="num" style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", color: "var(--text-mid)" }}>{row.referee_count}</td>
                            <td className="num" style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", color: "var(--text-mid)" }}>${fmtUSD(row.volume)}</td>
                            <td className="num" style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", fontWeight: 600, color: "var(--atm)" }}>${fmtUSD(row.rewards_earned)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Referee list ──────────────────────────────────────────── */}
              {dashboard.referees.length > 0 && (
                <div style={{ marginBottom: 32 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 10 }}>
                    Referred Traders ({dashboard.total_referees})
                  </div>
                  <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                          {["Wallet", "Joined", "Volume", "Rewards Generated"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-overlay)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.referees.map(r => (
                          <tr key={r.wallet_address} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-mid)" }}>
                              {r.wallet_address.slice(0, 8)}…{r.wallet_address.slice(-6)}
                            </td>
                            <td style={{ padding: "8px 12px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{fmtDate(r.joined_at)}</td>
                            <td className="num" style={{ padding: "8px 12px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>${fmtUSD(r.volume)}</td>
                            <td className="num" style={{ padding: "8px 12px", fontSize: 11, textAlign: "right", fontWeight: 600, color: "var(--call)" }}>${fmtUSD(r.rewards_generated)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ── Privacy opt-out ───────────────────────────────────────── */}
              <div style={{ padding: "14px 18px", border: "1px solid var(--border-subtle)", background: "var(--bg-raised)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 2 }}>Referral attribution tracking</div>
                  <div style={{ fontSize: 11, color: "var(--text-lo)" }}>
                    {optedOut
                      ? "You have opted out. Referral codes in links will not be stored or registered."
                      : "We capture the ?ref= code on landing (first-touch only) and register it when you connect your wallet."}
                  </div>
                </div>
                <button
                  onClick={toggleOptOut}
                  style={{ padding: "6px 14px", border: "1px solid var(--border-strong)", background: "transparent", color: optedOut ? "var(--call)" : "var(--text-mid)", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {optedOut ? "Opt back in" : "Opt out"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReferralsPage() {
  return (
    <Suspense fallback={<div style={{ background: "var(--bg)", minHeight: "100vh" }} />}>
      <ReferralsContent />
    </Suspense>
  );
}
