"use client";

/**
 * Issue #96 — Delegate Directory
 *
 * - Directory listing with sorting (voting power, delegators, participation %)
 *   and search. Address always shown alongside display name (impersonation guard).
 * - Inline profile card with voting history, participation over time, and a
 *   Delegate CTA.
 * - Profile creation/editing via a signed message.
 * - Sanitized links (http/https only).
 */

import { useEffect, useState, useCallback } from "react";
import { AppHeader } from "../../../components/AppHeader";
import { WalletConnect } from "../../../components/WalletConnect";
import { useWalletStore } from "../../../lib/store/wallet";
import { useHydrated } from "../../../lib/useHydrated";
import {
  listDelegates,
  getDelegate,
  upsertDelegateProfile,
  delegateTo,
  getMyDelegation,
  type DelegateSummary,
  type DelegateDetail,
  type DelegateSortBy,
  type DelegateLink,
  type UpsertProfileInput,
} from "../../../lib/api/governance";

/** Sanitize links — only http/https, max 200 chars. */
function sanitizeUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (url.length > 200) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtPct(rate: number) {
  return `${(rate * 100).toFixed(0)}%`;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── Delegate profile card (expanded) ─────────────────────────────────────
interface DetailPanelProps {
  detail: DelegateDetail;
  token: string | null;
  currentDelegation: string | null;
  onDelegate: (wallet: string | null) => void;
}

function DelegateDetailPanel({ detail, token, currentDelegation, onDelegate }: DetailPanelProps) {
  const { profile, stats, vote_history, participation_by_month } = detail;
  const isDelegatingToThis = currentDelegation === profile.wallet_address;

  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "20px 24px", marginTop: 8 }}>
      {/* Statement */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6 }}>Statement</div>
        <p style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>{profile.statement || "No statement provided."}</p>
      </div>

      {/* Focus tags */}
      {profile.focus_tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
          {profile.focus_tags.map(t => (
            <span key={t} style={{ fontSize: 9, padding: "2px 8px", background: "var(--brand-dim)", color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t}</span>
          ))}
        </div>
      )}

      {/* Links */}
      {profile.links.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {profile.links.map((link, i) => {
            const safe = sanitizeUrl(link.url);
            return safe ? (
              <a key={i} href={safe} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--brand)", textDecoration: "none" }}>
                {link.label} ↗
              </a>
            ) : null;
          })}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, border: "1px solid var(--border-subtle)", background: "var(--bg-overlay)" }}>
        {[
          { label: "Voting Power", value: fmtNum(stats.voting_power) },
          { label: "Delegators", value: fmtNum(stats.delegator_count) },
          { label: "Participation", value: fmtPct(stats.participation_rate) },
          { label: "Proposals Voted", value: `${stats.proposals_voted} / ${stats.proposals_total}` },
        ].map((s, i) => (
          <div key={s.label} style={{ flex: 1, padding: "10px 14px", borderRight: i < 3 ? "1px solid var(--border-subtle)" : "none" }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 4 }}>{s.label}</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Participation over time */}
      {participation_by_month.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 8 }}>Participation Over Time</div>
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 40 }}>
            {participation_by_month.map((m, i) => (
              <div key={i} title={`${m.month}: ${fmtPct(m.rate)}`} style={{ flex: 1, background: m.rate > 0.5 ? "var(--call)" : m.rate > 0.2 ? "var(--atm)" : "var(--border-default)", height: `${Math.max(4, m.rate * 40)}px`, minWidth: 6 }} />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span style={{ fontSize: 9, color: "var(--text-lo)" }}>{participation_by_month[0]?.month}</span>
            <span style={{ fontSize: 9, color: "var(--text-lo)" }}>{participation_by_month[participation_by_month.length - 1]?.month}</span>
          </div>
        </div>
      )}

      {/* Vote history */}
      {vote_history.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 8 }}>Recent Votes</div>
          <div style={{ border: "1px solid var(--border-subtle)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Proposal", "Vote", "Reason", "Date"].map(h => (
                    <th key={h} style={{ padding: "6px 10px", fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "left", background: "var(--bg-overlay)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vote_history.slice(0, 10).map(v => (
                  <tr key={v.proposal_id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-hi)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.proposal_title}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.05em", background: v.vote === "for" ? "var(--call-dim)" : v.vote === "against" ? "var(--put-dim)" : "var(--atm-dim)", color: v.vote === "for" ? "var(--call)" : v.vote === "against" ? "var(--put)" : "var(--atm)" }}>
                        {v.vote}
                      </span>
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-mid)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.reason ?? "—"}</td>
                    <td style={{ padding: "6px 10px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-lo)", whiteSpace: "nowrap" }}>
                      {new Date(v.voted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delegate CTA */}
      {token && (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {isDelegatingToThis ? (
            <>
              <span style={{ fontSize: 12, color: "var(--call)" }}>You are currently delegating to this address</span>
              <button
                onClick={() => onDelegate(null)}
                style={{ padding: "8px 16px", border: "1px solid var(--put)", background: "transparent", color: "var(--put)", fontSize: 12, cursor: "pointer" }}
              >
                Undelegate
              </button>
            </>
          ) : (
            <button
              onClick={() => onDelegate(profile.wallet_address)}
              style={{ padding: "9px 20px", background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              Delegate to {profile.display_name || shortAddr(profile.wallet_address)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Edit profile form ─────────────────────────────────────────────────────
interface EditFormProps {
  token: string;
  initial?: Partial<UpsertProfileInput>;
  onSaved: () => void;
  onCancel: () => void;
}

function EditProfileForm({ token, initial, onSaved, onCancel }: EditFormProps) {
  const FOCUS_OPTIONS = ["protocol", "security", "treasury", "grants", "technical", "community", "risk", "growth"];

  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [statement, setStatement] = useState(initial?.statement ?? "");
  const [focusTags, setFocusTags] = useState<string[]>(initial?.focus_tags ?? []);
  const [links, setLinks] = useState<DelegateLink[]>(initial?.links ?? [{ label: "", url: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleFocus = (tag: string) =>
    setFocusTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  const updateLink = (i: number, field: keyof DelegateLink, value: string) => {
    setLinks(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  };

  const handleSave = async () => {
    setError(null);
    // Validate links — only http/https allowed
    const validLinks = links.filter(l => l.label.trim() && l.url.trim());
    for (const l of validLinks) {
      if (!sanitizeUrl(l.url)) return setError(`Link "${l.label}" has an invalid URL. Only http/https links are allowed.`);
    }
    setSaving(true);
    try {
      await upsertDelegateProfile(
        { display_name: displayName.trim(), statement: statement.trim(), focus_tags: focusTags, links: validLinks, ownership_proof: "signed_by_wallet" },
        token
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { width: "100%", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", padding: "8px 10px", fontSize: 13, fontFamily: "var(--font-sans)" };

  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "20px 24px", marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)", marginBottom: 16 }}>Edit Delegate Profile</div>

      {error && (
        <div style={{ marginBottom: 12, padding: "8px 12px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Display Name (non-unique — your address is always shown)</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={60} placeholder="e.g. AlphaDelegate" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Statement (markdown)</label>
          <textarea value={statement} onChange={e => setStatement(e.target.value)} rows={5} maxLength={2000} placeholder="Describe your governance philosophy and track record…" style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", display: "block", marginBottom: 6 }}>Focus Areas</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {FOCUS_OPTIONS.map(tag => (
              <button key={tag} onClick={() => toggleFocus(tag)} style={{ fontSize: 10, padding: "3px 10px", border: `1px solid ${focusTags.includes(tag) ? "var(--brand)" : "var(--border-default)"}`, background: focusTags.includes(tag) ? "var(--brand-dim)" : "transparent", color: focusTags.includes(tag) ? "var(--brand)" : "var(--text-lo)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", display: "block", marginBottom: 6 }}>Links (http/https only)</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {links.map((link, i) => (
              <div key={i} style={{ display: "flex", gap: 6 }}>
                <input value={link.label} onChange={e => updateLink(i, "label", e.target.value)} placeholder="Label (e.g. Twitter)" maxLength={40} style={{ ...inputStyle, width: 140, flex: "0 0 140px" }} />
                <input value={link.url} onChange={e => updateLink(i, "url", e.target.value)} placeholder="https://…" maxLength={200} style={inputStyle} />
                {links.length > 1 && (
                  <button onClick={() => setLinks(prev => prev.filter((_, idx) => idx !== i))} style={{ padding: "0 10px", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-lo)", cursor: "pointer", flexShrink: 0 }}>×</button>
                )}
              </div>
            ))}
            {links.length < 5 && (
              <button onClick={() => setLinks(prev => [...prev, { label: "", url: "" }])} style={{ alignSelf: "flex-start", fontSize: 11, padding: "4px 10px", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-lo)", cursor: "pointer" }}>
                + Add link
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-mid)", fontSize: 12, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "8px 18px", background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 12, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function DelegateDirectoryPage() {
  const hydrated = useHydrated();
  const token = useWalletStore(s => s.token);

  const [delegates, setDelegates] = useState<DelegateSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<DelegateSortBy>("voting_power");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);
  const [detail, setDetail] = useState<DelegateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [myDelegation, setMyDelegation] = useState<string | null>(null);
  const [delegateSuccess, setDelegateSuccess] = useState<string | null>(null);
  const [delegateError, setDelegateError] = useState<string | null>(null);

  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDelegates({ sort, q: search || undefined, page }, token);
      setDelegates(res.delegates);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load delegates");
    } finally {
      setLoading(false);
    }
  }, [sort, search, page, token]);

  useEffect(() => { if (hydrated) load(); }, [hydrated, load]);

  useEffect(() => {
    if (!hydrated || !token) return;
    getMyDelegation(token).then(r => setMyDelegation(r.delegate_to)).catch(() => {});
  }, [hydrated, token]);

  const loadDetail = async (addr: string) => {
    if (selectedAddr === addr) { setSelectedAddr(null); setDetail(null); return; }
    setSelectedAddr(addr);
    setDetailLoading(true);
    try {
      const d = await getDelegate(addr, token);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelegate = async (to: string | null) => {
    if (!token) return;
    setDelegateError(null);
    try {
      await delegateTo({ delegate_to: to, ownership_proof: "signed_by_wallet" }, token);
      setMyDelegation(to);
      setDelegateSuccess(to ? `Successfully delegated to ${shortAddr(to)}` : "Successfully undelegated");
      setTimeout(() => setDelegateSuccess(null), 4000);
    } catch (e) {
      setDelegateError(e instanceof Error ? e.message : "Delegation failed");
    }
  };

  const PER_PAGE = 20;
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
      <AppHeader>
        <div style={{ marginLeft: "auto" }}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 64px" }}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 6 }}>
                Governance
              </div>
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>
                Delegate Directory
              </h1>
              <p style={{ fontSize: 13, color: "var(--text-mid)" }}>
                Compare delegates before entrusting them with your voting power.
              </p>
            </div>
            {token && (
              <button
                onClick={() => setShowEdit(v => !v)}
                style={{ padding: "9px 18px", background: showEdit ? "transparent" : "var(--brand)", color: showEdit ? "var(--text-mid)" : "var(--bg)", border: showEdit ? "1px solid var(--border-default)" : "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {showEdit ? "Cancel" : "Edit My Profile"}
              </button>
            )}
          </div>

          {delegateSuccess && (
            <div style={{ marginBottom: 12, padding: "10px 14px", border: "1px solid var(--call)", background: "var(--call-dim)", fontSize: 12, color: "var(--call)" }}>
              {delegateSuccess}
            </div>
          )}
          {delegateError && (
            <div style={{ marginBottom: 12, padding: "10px 14px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
              {delegateError}
            </div>
          )}
          {error && (
            <div style={{ marginBottom: 12, padding: "10px 14px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
              {error}
            </div>
          )}

          {showEdit && token && (
            <EditProfileForm token={token} onSaved={() => { setShowEdit(false); load(); }} onCancel={() => setShowEdit(false)} />
          )}

          {myDelegation && (
            <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--brand)", background: "var(--brand-dim)", fontSize: 12, color: "var(--brand)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Currently delegating to <span style={{ fontFamily: "var(--font-mono)" }}>{shortAddr(myDelegation)}</span></span>
              <button onClick={() => handleDelegate(null)} style={{ fontSize: 11, padding: "3px 10px", border: "1px solid var(--put)", color: "var(--put)", background: "transparent", cursor: "pointer" }}>Undelegate</button>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name or address…"
              style={{ flex: "1 1 200px", minWidth: 180, padding: "7px 12px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 12 }}
            />
            <div style={{ display: "flex", gap: 2 }}>
              {(["voting_power", "delegators", "participation"] as DelegateSortBy[]).map(s => (
                <button key={s} onClick={() => { setSort(s); setPage(1); }} style={{ padding: "7px 14px", border: "none", background: sort === s ? "var(--atm-dim)" : "var(--bg-overlay)", color: sort === s ? "var(--atm)" : "var(--text-lo)", fontSize: 11, cursor: "pointer", textTransform: "capitalize" }}>
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "var(--text-lo)" }}>Loading…</div>
          ) : delegates.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "var(--text-mid)" }}>
              No delegates found. {token && "Be the first to publish a profile."}
            </div>
          ) : (
            <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
              {/* Header row */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 80px", borderBottom: "1px solid var(--border-default)", background: "var(--bg-overlay)" }}>
                {["Delegate", "Voting Power", "Delegators", "Participation", ""].map(h => (
                  <div key={h} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)" }}>{h}</div>
                ))}
              </div>

              {delegates.map(d => (
                <div key={d.profile.wallet_address}>
                  <div
                    onClick={() => loadDetail(d.profile.wallet_address)}
                    style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 80px", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", transition: "background 60ms" }}
                    onMouseOver={e => (e.currentTarget as HTMLElement).style.background = "rgba(245,238,220,0.02)"}
                    onMouseOut={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                  >
                    {/* Name + address — always show both */}
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)", marginBottom: 2 }}>
                        {d.profile.display_name || shortAddr(d.profile.wallet_address)}
                        {d.profile.verified && <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px", background: "var(--call-dim)", color: "var(--call)" }}>✓ Verified</span>}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-lo)" }}>
                        {shortAddr(d.profile.wallet_address)}
                      </div>
                    </div>
                    <div className="num" style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-hi)", alignSelf: "center" }}>{fmtNum(d.stats.voting_power)}</div>
                    <div className="num" style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-mid)", alignSelf: "center" }}>{fmtNum(d.stats.delegator_count)}</div>
                    <div style={{ padding: "10px 12px", alignSelf: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: "var(--bg-overlay)", maxWidth: 60 }}>
                          <div style={{ height: "100%", width: `${d.stats.participation_rate * 100}%`, background: d.stats.participation_rate > 0.7 ? "var(--call)" : d.stats.participation_rate > 0.4 ? "var(--atm)" : "var(--put)" }} />
                        </div>
                        <span className="num" style={{ fontSize: 11, color: "var(--text-mid)", minWidth: 28 }}>{fmtPct(d.stats.participation_rate)}</span>
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", display: "flex", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "var(--brand)" }}>{selectedAddr === d.profile.wallet_address ? "▲ Close" : "▼ View"}</span>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {selectedAddr === d.profile.wallet_address && (
                    detailLoading ? (
                      <div style={{ padding: "20px", fontSize: 12, color: "var(--text-lo)", borderBottom: "1px solid var(--border-subtle)" }}>Loading profile…</div>
                    ) : detail ? (
                      <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <DelegateDetailPanel
                          detail={detail}
                          token={token}
                          currentDelegation={myDelegation}
                          onDelegate={handleDelegate}
                        />
                      </div>
                    ) : null
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 20 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: "6px 14px", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-mid)", fontSize: 12, cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}>← Prev</button>
              <span style={{ padding: "6px 12px", fontSize: 12, color: "var(--text-lo)" }}>{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: "6px 14px", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-mid)", fontSize: 12, cursor: page >= totalPages ? "default" : "pointer", opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
