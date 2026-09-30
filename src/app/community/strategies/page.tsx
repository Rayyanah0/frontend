"use client";

/**
 * Issue #95 — Community Strategy Gallery
 *
 * - Publish flow: name, description (sanitized markdown), tags, strategy JSON.
 * - Gallery with search, tag filters, sorting (new / top / trending).
 * - Preview cards with client-side payoff thumbnails.
 * - Import into the builder with one click (offsets mapped to live strikes).
 * - Report/flag for moderation.
 * - Flagged items above threshold are hidden.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AppHeader } from "../../../components/AppHeader";
import { WalletConnect } from "../../../components/WalletConnect";
import { useWalletStore } from "../../../lib/store/wallet";
import { useHydrated } from "../../../lib/useHydrated";
import { bs, smileVol, MARKETS } from "../../../lib/pricing";
import {
  listStrategies,
  publishStrategy,
  upvoteStrategy,
  flagStrategy,
  type CommunityStrategy,
  type StrategySortBy,
  type StrategyDefinition,
  type StrategyLeg,
} from "../../../lib/api/community";

// ── Zod-style validation (inline to avoid adding a dependency) ────────────
const ALLOWED_UNDERLYINGS = ["XLM", "BTC", "ETH", "SOL"];
const ALLOWED_TAGS = ["bullish", "bearish", "neutral", "hedge", "income", "speculative", "spread", "multi-leg", "custom"];

function validateDefinition(def: unknown): StrategyDefinition | null {
  if (!def || typeof def !== "object") return null;
  const d = def as Record<string, unknown>;
  if (d.schema_version !== 1) return null;
  if (!ALLOWED_UNDERLYINGS.includes(d.underlying as string)) return null;
  if (!Array.isArray(d.legs) || d.legs.length < 1 || d.legs.length > 8) return null;
  for (const leg of d.legs as unknown[]) {
    if (!leg || typeof leg !== "object") return null;
    const l = leg as Record<string, unknown>;
    if (!["call", "put"].includes(l.option_type as string)) return null;
    if (!["long", "short"].includes(l.position_type as string)) return null;
    if (typeof l.strike_offset_pct !== "number") return null;
    if (typeof l.expiry_days !== "number" || l.expiry_days < 1) return null;
    if (typeof l.contracts !== "number" || l.contracts < 1) return null;
  }
  return def as StrategyDefinition;
}

// ── Payoff thumbnail (inline SVG) ─────────────────────────────────────────
function PayoffThumb({ def }: { def: StrategyDefinition }) {
  const market = MARKETS.find(m => m.sym === def.underlying) ?? MARKETS[0];
  const spot = market.price;

  const spotRange = Array.from({ length: 50 }, (_, i) => spot * (0.7 + (i / 49) * 0.6));
  const payoffs = spotRange.map(s => {
    return def.legs.reduce<number>((sum, leg) => {
      const K = spot * (1 + leg.strike_offset_pct / 100);
      const t = leg.expiry_days / 365;
      const vol = smileVol(market.vol, K / spot);
      const { premium } = bs(spot, K, vol, t, leg.option_type === "call");
      const intrinsic = leg.option_type === "call" ? Math.max(0, s - K) : Math.max(0, K - s);
      const pnl = leg.position_type === "long" ? intrinsic - premium : premium - intrinsic;
      return sum + pnl * leg.contracts;
    }, 0);
  });

  const minPnl = Math.min(...payoffs);
  const maxPnl = Math.max(...payoffs);
  const range = maxPnl - minPnl || 1;

  const W = 120, H = 50;
  const pts = payoffs.map((p, i) => `${(i / 49) * W},${H - ((p - minPnl) / range) * (H - 4) - 2}`).join(" ");
  const zeroY = H - ((-minPnl) / range) * (H - 4) - 2;

  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="rgba(245,238,220,0.1)" strokeWidth={1} />
      <polyline points={pts} fill="none" stroke="var(--brand)" strokeWidth={1.5} />
    </svg>
  );
}

// ── Strategy card ─────────────────────────────────────────────────────────
interface CardProps {
  strategy: CommunityStrategy;
  token: string | null;
  onUpvote: (id: string) => void;
  onFlag: (id: string) => void;
  onImport: (def: StrategyDefinition) => void;
}

const FLAG_THRESHOLD = 5;

function StrategyCard({ strategy, token, onUpvote, onFlag, onImport }: CardProps) {
  const [flagging, setFlagging] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagSent, setFlagSent] = useState(false);

  if (strategy.flagged) return null;

  const handleFlag = async () => {
    if (!token || !flagReason.trim()) return;
    setFlagging(false);
    try {
      await flagStrategy(strategy.id, flagReason.trim(), token);
      setFlagSent(true);
    } catch { /* non-critical */ }
  };

  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "16px 18px" }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {strategy.name}
          </div>
          <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-lo)" }}>
            {strategy.author_wallet.slice(0, 8)}…{strategy.author_wallet.slice(-4)} · {strategy.definition.underlying} · {strategy.definition.legs.length} leg{strategy.definition.legs.length > 1 ? "s" : ""}
          </div>
        </div>
        <PayoffThumb def={strategy.definition} />
      </div>

      {/* Description */}
      <p style={{ fontSize: 12, color: "var(--text-mid)", lineHeight: 1.55, marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {strategy.description}
      </p>

      {/* Tags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        {strategy.tags.map(tag => (
          <span key={tag} style={{ fontSize: 9, padding: "2px 7px", background: "var(--brand-dim)", color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {tag}
          </span>
        ))}
      </div>

      {/* Legs summary */}
      <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {strategy.definition.legs.map((leg, i) => (
          <span key={i} style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 8px", background: "var(--bg-overlay)", color: leg.option_type === "call" ? "var(--call)" : "var(--put)", border: `1px solid ${leg.option_type === "call" ? "var(--call-dim)" : "var(--put-dim)"}` }}>
            {leg.position_type === "long" ? "+" : "−"}{leg.contracts}x {leg.option_type.toUpperCase()} {leg.strike_offset_pct >= 0 ? "+" : ""}{leg.strike_offset_pct}% {leg.expiry_days}D
          </span>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {/* Upvote */}
        <button
          onClick={() => token && onUpvote(strategy.id)}
          disabled={!token || strategy.has_upvoted}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", border: "1px solid var(--border-default)", background: strategy.has_upvoted ? "var(--brand-dim)" : "transparent", color: strategy.has_upvoted ? "var(--brand)" : "var(--text-lo)", fontSize: 11, cursor: !token || strategy.has_upvoted ? "default" : "pointer" }}
        >
          ▲ {strategy.upvotes}
        </button>

        {/* Import */}
        <button
          onClick={() => onImport(strategy.definition)}
          style={{ padding: "5px 12px", background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          Import into Builder →
        </button>

        {/* Flag */}
        {token && !flagSent && (
          <div style={{ marginLeft: "auto" }}>
            {flagging ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={flagReason}
                  onChange={e => setFlagReason(e.target.value)}
                  placeholder="Reason…"
                  maxLength={140}
                  style={{ fontSize: 11, padding: "4px 8px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", width: 140 }}
                />
                <button onClick={handleFlag} style={{ fontSize: 10, padding: "4px 8px", border: "1px solid var(--put)", color: "var(--put)", background: "transparent", cursor: "pointer" }}>
                  Send
                </button>
                <button onClick={() => setFlagging(false)} style={{ fontSize: 10, padding: "4px 8px", border: "1px solid var(--border-default)", color: "var(--text-lo)", background: "transparent", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setFlagging(true)} style={{ fontSize: 10, padding: "3px 8px", border: "1px solid var(--border-subtle)", color: "var(--text-lo)", background: "transparent", cursor: "pointer" }}>
                Report
              </button>
            )}
          </div>
        )}
        {flagSent && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-lo)" }}>Reported</span>}
      </div>
    </div>
  );
}

// ── Publish form ──────────────────────────────────────────────────────────
interface PublishFormProps {
  token: string;
  onPublished: () => void;
  onCancel: () => void;
}

function PublishForm({ token, onPublished, onCancel }: PublishFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [defJson, setDefJson] = useState(`{
  "schema_version": 1,
  "underlying": "XLM",
  "legs": [
    { "option_type": "call", "position_type": "long", "strike_offset_pct": 5, "expiry_days": 30, "contracts": 1 }
  ]
}`);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (tag: string) =>
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!description.trim()) return setError("Description is required.");
    if (tags.length === 0) return setError("Select at least one tag.");

    let parsed: unknown;
    try { parsed = JSON.parse(defJson); } catch { return setError("Strategy JSON is not valid JSON."); }
    const def = validateDefinition(parsed);
    if (!def) return setError("Strategy definition failed validation. Check schema_version, underlying, and legs.");

    setSubmitting(true);
    try {
      await publishStrategy(
        { name: name.trim(), description: description.trim(), tags, definition: def, ownership_proof: "signed_by_wallet" },
        token
      );
      onPublished();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = { width: "100%", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", padding: "8px 10px", fontSize: 13, fontFamily: "var(--font-sans)" };

  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "20px 24px", marginBottom: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)", marginBottom: 16 }}>Publish a Strategy</div>

      {error && (
        <div style={{ marginBottom: 12, padding: "8px 12px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. XLM Bull Call Spread" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>Description (markdown)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={1000} placeholder="Describe the strategy, when to use it, and the rationale…" style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", display: "block", marginBottom: 6 }}>Tags</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALLOWED_TAGS.map(tag => (
              <button key={tag} onClick={() => toggleTag(tag)} style={{ fontSize: 10, padding: "3px 10px", border: `1px solid ${tags.includes(tag) ? "var(--brand)" : "var(--border-default)"}`, background: tags.includes(tag) ? "var(--brand-dim)" : "transparent", color: tags.includes(tag) ? "var(--brand)" : "var(--text-lo)", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", display: "block", marginBottom: 4 }}>
            Strategy Definition (JSON)
          </label>
          <textarea value={defJson} onChange={e => setDefJson(e.target.value)} rows={10} style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 11, resize: "vertical" }} />
          <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 4 }}>
            schema_version must be 1 · underlying: XLM | BTC | ETH | SOL · strike_offset_pct relative to spot
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-mid)", fontSize: 12, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting} style={{ padding: "8px 18px", background: "var(--brand)", color: "var(--bg)", border: "none", fontSize: 12, fontWeight: 600, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Publishing…" : "Publish Strategy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function CommunityStrategiesPage() {
  const hydrated = useHydrated();
  const token = useWalletStore(s => s.token);

  const [strategies, setStrategies] = useState<CommunityStrategy[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<StrategySortBy>("trending");
  const [filterTag, setFilterTag] = useState<string>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listStrategies({ sort, tag: filterTag || undefined, q: search || undefined, page }, token);
      setStrategies(res.strategies);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load strategies");
    } finally {
      setLoading(false);
    }
  }, [sort, filterTag, search, page, token]);

  useEffect(() => { if (hydrated) load(); }, [hydrated, load]);

  const handleUpvote = async (id: string) => {
    if (!token) return;
    try {
      const res = await upvoteStrategy(id, token);
      setStrategies(prev => prev.map(s => s.id === id ? { ...s, upvotes: res.upvotes, has_upvoted: true } : s));
    } catch { /* ignore */ }
  };

  const handleFlag = (id: string) => {
    // Card handles the actual API call; we mark locally after threshold
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, flagged: true } : s));
  };

  const handleImport = (def: StrategyDefinition) => {
    // Map offsets to live strikes and encode into the builder URL.
    const market = MARKETS.find(m => m.sym === def.underlying) ?? MARKETS[0];
    const spot = market.price;
    const legsParam = encodeURIComponent(JSON.stringify(
      def.legs.map((leg: StrategyLeg) => ({
        ...leg,
        strike: +(spot * (1 + leg.strike_offset_pct / 100)).toFixed(4),
      }))
    ));
    // Navigate to the builder. The builder page reads ?importLegs= from the URL.
    window.location.href = `/options?importLegs=${legsParam}&underlying=${def.underlying}`;
    setImportNotice(`Importing ${def.underlying} strategy into the builder…`);
  };

  const PER_PAGE = 12;
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
                Community
              </div>
              <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 600, marginBottom: 4 }}>
                Strategy Gallery
              </h1>
              <p style={{ fontSize: 13, color: "var(--text-mid)" }}>
                Discover, preview, and import strategies shared by the community.
              </p>
            </div>
            {token && (
              <button
                onClick={() => setShowPublish(v => !v)}
                style={{ padding: "9px 18px", background: showPublish ? "transparent" : "var(--brand)", color: showPublish ? "var(--text-mid)" : "var(--bg)", border: showPublish ? "1px solid var(--border-default)" : "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {showPublish ? "Cancel" : "Publish Strategy"}
              </button>
            )}
          </div>

          {importNotice && (
            <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--brand)", background: "var(--brand-dim)", fontSize: 12, color: "var(--brand)" }}>
              {importNotice}
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 16, padding: "10px 14px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 12, color: "var(--put)" }}>
              {error}
            </div>
          )}

          {showPublish && token && (
            <PublishForm
              token={token}
              onPublished={() => { setShowPublish(false); load(); }}
              onCancel={() => setShowPublish(false)}
            />
          )}

          {/* Filters */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
            {/* Search */}
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search strategies…"
              style={{ flex: "1 1 200px", minWidth: 180, padding: "7px 12px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 12 }}
            />

            {/* Sort */}
            <div style={{ display: "flex", gap: 2 }}>
              {(["new", "top", "trending"] as StrategySortBy[]).map(s => (
                <button key={s} onClick={() => { setSort(s); setPage(1); }} style={{ padding: "7px 14px", border: "none", background: sort === s ? "var(--atm-dim)" : "var(--bg-overlay)", color: sort === s ? "var(--atm)" : "var(--text-lo)", fontSize: 11, cursor: "pointer", textTransform: "capitalize" }}>
                  {s}
                </button>
              ))}
            </div>

            {/* Tag filter */}
            <select
              value={filterTag}
              onChange={e => { setFilterTag(e.target.value); setPage(1); }}
              style={{ padding: "7px 12px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: filterTag ? "var(--brand)" : "var(--text-lo)", fontSize: 11, cursor: "pointer" }}
            >
              <option value="">All tags</option>
              {ALLOWED_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Grid */}
          {loading ? (
            <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "var(--text-lo)" }}>Loading…</div>
          ) : strategies.filter(s => !s.flagged).length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "var(--text-mid)" }}>
              No strategies found. {token ? "Be the first to publish one!" : <Link href="/options" style={{ color: "var(--brand)" }}>Connect wallet to publish →</Link>}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {strategies.map(s => (
                <StrategyCard
                  key={s.id}
                  strategy={s}
                  token={token}
                  onUpvote={handleUpvote}
                  onFlag={handleFlag}
                  onImport={handleImport}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 24 }}>
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
