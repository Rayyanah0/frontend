"use client";

/**
 * Issue #92 — Public Protocol Analytics Dashboard
 *
 * Metrics displayed:
 *   - TVL, Open Interest, Notional Volume 24h, Premium Volume 24h
 *   - Fees 24h + cumulative, Active Traders 24h + 7d, Put/Call Ratio
 * All KPI tiles show 24h and 7d delta with directional colouring.
 *
 * Charts (inline SVG — no external charting dependency):
 *   - Time-series sparklines / full charts per metric with range selector
 *     (24h | 7d | 30d | 90d | all)
 *   - OI breakdown by underlying (stacked call/put bar chart)
 *   - OI breakdown by expiry bucket
 *   - Put/call ratio by underlying
 *   - Max-pain per underlying: OI-by-strike bar chart with max-pain line
 *
 * Data strategy:
 *   - Tries the real /stats endpoint; falls back to MOCK_STATS fixture
 *     so the page is always renderable in dev without a live indexer.
 *   - A JSON endpoint link is exposed at /stats/data.json for aggregators.
 *   - iframe-embed safe: the embed route is /stats/embed (no nav chrome).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Logo } from "../../../components/Logo";
import {
  getProtocolStats,
  getStatHistory,
  MOCK_STATS,
  MOCK_HISTORIES,
  type ProtocolStats,
  type TimePoint,
  type StatRange,
  type OiBucket,
  type MaxPainResult,
  type KpiMetric,
} from "../../../lib/api/stats";

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtUSD(n: number, compact = true): string {
  if (compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtDate(ts: number, range: StatRange): string {
  const d = new Date(ts);
  if (range === "24h") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Inline SVG chart primitives ───────────────────────────────────────────

interface LineChartProps {
  points: TimePoint[];
  width?: number;
  height?: number;
  range: StatRange;
  color?: string;
  filled?: boolean;
  label?: string;
}

function LineChart({ points, width = 600, height = 120, range, color = "var(--brand)", filled = true, label }: LineChartProps) {
  if (!points.length) return (
    <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 11, color: "var(--text-lo)" }}>No data</span>
    </div>
  );

  const PAD = { top: 8, right: 12, bottom: 24, left: 8 };
  const W = width - PAD.left - PAD.right;
  const H = height - PAD.top - PAD.bottom;

  const vals  = points.map(p => p.value);
  const minV  = Math.min(...vals);
  const maxV  = Math.max(...vals);
  const range_ = maxV - minV || 1;

  const xOf = (i: number) => PAD.left + (i / (points.length - 1)) * W;
  const yOf = (v: number) => PAD.top + H - ((v - minV) / range_) * H;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ");
  const fillD = `${pathD} L${xOf(points.length - 1).toFixed(1)},${(PAD.top + H).toFixed(1)} L${PAD.left.toFixed(1)},${(PAD.top + H).toFixed(1)} Z`;

  // x-axis labels — 5 evenly spaced
  const labelIdxs = [0, Math.floor(points.length * 0.25), Math.floor(points.length * 0.5), Math.floor(points.length * 0.75), points.length - 1];

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={`fill-${label ?? "chart"}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      {/* zero line at bottom */}
      <line x1={PAD.left} y1={PAD.top + H} x2={PAD.left + W} y2={PAD.top + H} stroke="var(--border-subtle)" strokeWidth={1} />
      {/* fill */}
      {filled && <path d={fillD} fill={`url(#fill-${label ?? "chart"})`} />}
      {/* line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* x-axis labels */}
      {labelIdxs.map(i => (
        <text key={i} x={xOf(i)} y={PAD.top + H + 14} textAnchor="middle" fontSize={9} fill="var(--text-lo)" fontFamily="var(--font-mono)">
          {fmtDate(points[i].ts, range)}
        </text>
      ))}
    </svg>
  );
}

// Stacked horizontal bar for OI by underlying
interface OiBarProps {
  buckets: OiBucket[];
  groupBy: "underlying" | "expiry";
  width?: number;
}

function OiBarChart({ buckets, groupBy, width = 560 }: OiBarProps) {
  type Group = { key: string; call: number; put: number };
  const grouped = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const b of buckets) {
      const key = groupBy === "underlying" ? b.underlying : `${b.expiry_days}D`;
      const g = map.get(key) ?? { key, call: 0, put: 0 };
      g.call += b.call_oi;
      g.put  += b.put_oi;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => (b.call + b.put) - (a.call + a.put));
  }, [buckets, groupBy]);

  const maxTotal = Math.max(...grouped.map(g => g.call + g.put)) || 1;
  const ROW_H = 22;
  const LABEL_W = 52;
  const BAR_W = width - LABEL_W - 60;
  const height = grouped.length * ROW_H + 8;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {grouped.map((g, i) => {
        const callW = (g.call / maxTotal) * BAR_W;
        const putW  = (g.put  / maxTotal) * BAR_W;
        const y = i * ROW_H + 4;
        return (
          <g key={g.key}>
            <text x={LABEL_W - 6} y={y + 13} textAnchor="end" fontSize={10} fill="var(--text-mid)" fontFamily="var(--font-mono)">{g.key}</text>
            {/* call bar */}
            <rect x={LABEL_W} y={y + 2} width={callW} height={ROW_H - 6} fill="var(--call)" opacity={0.75} rx={0} />
            {/* put bar */}
            <rect x={LABEL_W + callW} y={y + 2} width={putW} height={ROW_H - 6} fill="var(--put)" opacity={0.75} rx={0} />
            {/* total label */}
            <text x={LABEL_W + callW + putW + 5} y={y + 13} fontSize={9} fill="var(--text-lo)" fontFamily="var(--font-mono)">
              {fmtUSD(g.call + g.put)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Max-pain chart: grouped call/put bars per strike with a max-pain vertical line
interface MaxPainChartProps {
  data: MaxPainResult;
  width?: number;
  height?: number;
}

function MaxPainChart({ data, width = 480, height = 140 }: MaxPainChartProps) {
  const { strikes, max_pain_strike } = data;
  if (!strikes.length) return null;

  const PAD = { top: 10, right: 16, bottom: 28, left: 10 };
  const W = width - PAD.left - PAD.right;
  const H = height - PAD.top - PAD.bottom;
  const n = strikes.length;
  const barW = W / n;
  const halfW = barW * 0.38;

  const maxOi = Math.max(...strikes.map(s => Math.max(s.call_oi, s.put_oi))) || 1;

  const xOf = (i: number) => PAD.left + (i + 0.5) * barW;
  const hOf = (v: number) => (v / maxOi) * H;

  const mpIdx = strikes.findIndex(s => s.strike === max_pain_strike);
  const mpX = mpIdx >= 0 ? xOf(mpIdx) : -1;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {/* baseline */}
      <line x1={PAD.left} y1={PAD.top + H} x2={PAD.left + W} y2={PAD.top + H} stroke="var(--border-subtle)" strokeWidth={1} />

      {strikes.map((s, i) => {
        const x = xOf(i);
        const callH = hOf(s.call_oi);
        const putH  = hOf(s.put_oi);
        return (
          <g key={s.strike}>
            {/* call bar */}
            <rect x={x - halfW - 1} y={PAD.top + H - callH} width={halfW} height={callH} fill="var(--call)" opacity={0.7} />
            {/* put bar */}
            <rect x={x + 1} y={PAD.top + H - putH} width={halfW} height={putH} fill="var(--put)" opacity={0.7} />
            {/* strike label */}
            <text x={x} y={PAD.top + H + 14} textAnchor="middle" fontSize={8} fill="var(--text-lo)" fontFamily="var(--font-mono)">
              {s.strike >= 1000 ? `${(s.strike / 1000).toFixed(0)}K` : s.strike.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}
            </text>
          </g>
        );
      })}

      {/* Max-pain line */}
      {mpX >= 0 && (
        <>
          <line x1={mpX} y1={PAD.top} x2={mpX} y2={PAD.top + H} stroke="var(--atm)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={mpX + 4} y={PAD.top + 10} fontSize={9} fill="var(--atm)" fontFamily="var(--font-mono)">Max Pain</text>
        </>
      )}
    </svg>
  );
}

// ── KPI tile ──────────────────────────────────────────────────────────────

interface KpiTileProps {
  label: string;
  metric: KpiMetric;
  fmt?: (v: number) => string;
  isRatio?: boolean;
}

function KpiTile({ label, metric, fmt = fmtUSD, isRatio = false }: KpiTileProps) {
  const d24 = metric.change_24h_pct;
  const d7  = metric.change_7d_pct;

  return (
    <div style={{ padding: "16px 18px", background: "var(--bg-raised)", border: "1px solid var(--border-default)" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 8 }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-hi)", marginBottom: 10, letterSpacing: "-0.01em" }}>
        {isRatio ? metric.value.toFixed(2) : fmt(metric.value)}
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        <div>
          <div style={{ fontSize: 9, color: "var(--text-lo)", marginBottom: 2 }}>24h</div>
          <div className="num" style={{ fontSize: 11, fontWeight: 600, color: d24 >= 0 ? "var(--call)" : "var(--put)" }}>
            {fmtPct(d24)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: "var(--text-lo)", marginBottom: 2 }}>7d</div>
          <div className="num" style={{ fontSize: 11, fontWeight: 600, color: d7 >= 0 ? "var(--call)" : "var(--put)" }}>
            {fmtPct(d7)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Put/call ratio bar by underlying ─────────────────────────────────────

function PcRatioByUnderlying({ buckets }: { buckets: OiBucket[] }) {
  type U = { underlying: string; ratio: number };
  const byUnderlying = useMemo<U[]>(() => {
    const map = new Map<string, { call: number; put: number }>();
    for (const b of buckets) {
      const e = map.get(b.underlying) ?? { call: 0, put: 0 };
      e.call += b.call_oi; e.put += b.put_oi;
      map.set(b.underlying, e);
    }
    return Array.from(map.entries()).map(([u, v]) => ({
      underlying: u, ratio: v.call > 0 ? +(v.put / v.call).toFixed(3) : 0,
    }));
  }, [buckets]);

  const maxRatio = Math.max(...byUnderlying.map(u => u.ratio), 1.5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {byUnderlying.map(u => (
        <div key={u.underlying} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text-hi)", width: 32, flexShrink: 0 }}>
            {u.underlying}
          </div>
          <div style={{ flex: 1, height: 10, background: "var(--bg-overlay)", position: "relative" }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(u.ratio / maxRatio) * 100}%`, background: u.ratio > 1 ? "var(--put)" : "var(--call)", opacity: 0.8 }} />
          </div>
          <div className="num" style={{ fontSize: 11, color: u.ratio > 1 ? "var(--put)" : "var(--call)", width: 36, textAlign: "right" }}>
            {u.ratio.toFixed(2)}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 8, height: 8, background: "var(--call)" }} />
          <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Put/Call &lt; 1 (call-heavy)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 8, height: 8, background: "var(--put)" }} />
          <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Put/Call &gt; 1 (put-heavy)</span>
        </div>
      </div>
    </div>
  );
}

// ── Chart section with range selector ────────────────────────────────────

const CHART_METRICS: { key: string; label: string; fmt: (v: number) => string; color: string }[] = [
  { key: "tvl",                 label: "TVL",                 fmt: fmtUSD,  color: "var(--brand)" },
  { key: "open_interest",       label: "Open Interest",       fmt: fmtUSD,  color: "var(--call)"  },
  { key: "notional_volume_24h", label: "Notional Volume",     fmt: fmtUSD,  color: "var(--atm)"   },
  { key: "premium_volume_24h",  label: "Premium Volume",      fmt: fmtUSD,  color: "var(--atm)"   },
  { key: "fees_24h",            label: "Fees",                fmt: fmtUSD,  color: "var(--put)"   },
  { key: "active_traders_24h",  label: "Active Traders",      fmt: fmtNum,  color: "var(--call)"  },
  { key: "put_call_ratio",      label: "Put/Call Ratio",      fmt: (v) => v.toFixed(3), color: "var(--text-mid)" },
];

const RANGES: StatRange[] = ["24h", "7d", "30d", "90d", "all"];

function HistoricalChartsSection() {
  const [activeMetric, setActiveMetric] = useState(CHART_METRICS[0].key);
  const [activeRange, setActiveRange] = useState<StatRange>("30d");
  const [series, setSeries] = useState<TimePoint[]>([]);
  const [loading, setLoading] = useState(false);

  const metaDef = CHART_METRICS.find(m => m.key === activeMetric) ?? CHART_METRICS[0];

  useEffect(() => {
    setLoading(true);
    getStatHistory(activeMetric, activeRange)
      .then(r => setSeries(r.points))
      .catch(() => {
        // Fallback to mock
        const hist = MOCK_HISTORIES[activeMetric];
        if (!hist) return setSeries([]);
        const dayMs = 86_400_000;
        const rangeMs: Record<StatRange, number> = {
          "24h": dayMs, "7d": 7 * dayMs, "30d": 30 * dayMs, "90d": 90 * dayMs, "all": Infinity,
        };
        const cutoff = Date.now() - rangeMs[activeRange];
        setSeries(hist.filter(p => p.ts >= cutoff));
      })
      .finally(() => setLoading(false));
  }, [activeMetric, activeRange]);

  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 12 }}>
        Historical Charts
      </div>

      {/* Metric selector */}
      <div style={{ display: "flex", gap: 2, flexWrap: "wrap", marginBottom: 12 }}>
        {CHART_METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setActiveMetric(m.key)}
            style={{ padding: "5px 12px", border: "none", background: activeMetric === m.key ? "var(--brand-dim)" : "var(--bg-overlay)", color: activeMetric === m.key ? "var(--brand)" : "var(--text-lo)", fontSize: 11, cursor: "pointer" }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Range selector */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
        {RANGES.map(r => (
          <button
            key={r}
            onClick={() => setActiveRange(r)}
            style={{ padding: "4px 10px", border: "none", background: activeRange === r ? "var(--atm-dim)" : "transparent", color: activeRange === r ? "var(--atm)" : "var(--text-lo)", fontSize: 10, cursor: "pointer", fontFamily: "var(--font-mono)" }}
          >
            {r}
          </button>
        ))}
      </div>

      <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "16px 20px" }}>
        <div style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 12 }}>
          {metaDef.label}
          {series.length > 0 && (
            <span className="num" style={{ marginLeft: 12, fontWeight: 600, color: "var(--text-hi)" }}>
              {metaDef.fmt(series[series.length - 1].value)}
            </span>
          )}
        </div>
        {loading ? (
          <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-lo)" }}>Loading…</span>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <LineChart points={series} width={660} height={140} range={activeRange} color={metaDef.color} filled label={activeMetric} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [selectedUnderlying, setSelectedUnderlying] = useState("XLM");

  const load = useCallback(() => {
    setLoading(true);
    getProtocolStats()
      .then(s => { setStats(s); setUsingMock(false); })
      .catch(() => { setStats(MOCK_STATS); setUsingMock(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const underlyings = useMemo(() => {
    if (!stats) return [];
    const seen: string[] = [];
    for (const b of stats.oi_by_bucket) {
      if (!seen.includes(b.underlying)) seen.push(b.underlying);
    }
    return seen;
  }, [stats]);

  const selectedMaxPain = useMemo(() =>
    stats?.max_pain.find(m => m.underlying === selectedUnderlying) ?? null,
    [stats, selectedUnderlying]
  );

  const updatedAt = stats ? new Date(stats.updated_at).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }) : "—";

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", fontFamily: "var(--font-sans)", color: "var(--text-hi)" }}>

      {/* Nav */}
      <nav style={{ position: "sticky", top: 0, zIndex: 50, height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", borderBottom: "1px solid var(--border-default)", background: "rgba(20,19,15,0.9)", backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Logo size={18} />
            <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-serif)" }}>Zenith</span>
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            {[["Options Chain", "/options"], ["Portfolio", "/portfolio"], ["Stats", "/stats"]].map(([l, h]) => (
              <Link key={l} href={h} style={{ fontSize: 13, color: h === "/stats" ? "var(--brand)" : "var(--text-mid)", textDecoration: "none" }}>{l}</Link>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* JSON endpoint link for aggregators */}
          <a
            href="/api/stats.json"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "4px 10px", border: "1px solid var(--border-default)", color: "var(--text-lo)", textDecoration: "none" }}
          >
            JSON ↗
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: usingMock ? "var(--atm)" : "var(--call)" }} />
            <span style={{ fontSize: 11, color: "var(--text-lo)" }}>{usingMock ? "Mock data" : `Live · ${updatedAt}`}</span>
          </div>
        </div>
      </nav>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 80px" }}>

        {/* Page header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 6 }}>Protocol</div>
          <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 28, fontWeight: 600, marginBottom: 6 }}>Analytics</h1>
          <p style={{ fontSize: 13, color: "var(--text-mid)" }}>
            Public protocol-wide metrics. All figures are on-chain and verifiable.
            {usingMock && (
              <span style={{ marginLeft: 10, fontSize: 11, padding: "2px 8px", background: "var(--atm-dim)", color: "var(--atm)" }}>
                ⚠ Indexer unavailable — showing fixture data
              </span>
            )}
          </p>
        </div>

        {loading ? (
          <div style={{ padding: "80px 0", textAlign: "center", fontSize: 13, color: "var(--text-lo)" }}>Loading…</div>
        ) : stats && (
          <>
            {/* ── KPI grid ───────────────────────────────────────────── */}
            <section style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 12 }}>
                Key Metrics
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 1, background: "var(--border-default)", border: "1px solid var(--border-default)" }}>
                <KpiTile label="Total Value Locked"     metric={stats.tvl}                  fmt={fmtUSD} />
                <KpiTile label="Open Interest"          metric={stats.open_interest}         fmt={fmtUSD} />
                <KpiTile label="Notional Volume 24h"    metric={stats.notional_volume_24h}   fmt={fmtUSD} />
                <KpiTile label="Premium Volume 24h"     metric={stats.premium_volume_24h}    fmt={fmtUSD} />
                <KpiTile label="Fees 24h"               metric={stats.fees_24h}              fmt={fmtUSD} />
                <KpiTile label="Cumulative Fees"        metric={stats.fees_total}            fmt={fmtUSD} />
                <KpiTile label="Active Traders 24h"     metric={stats.active_traders_24h}    fmt={fmtNum} />
                <KpiTile label="Active Traders 7d"      metric={stats.active_traders_7d}     fmt={fmtNum} />
                <KpiTile label="Put / Call Ratio"       metric={stats.put_call_ratio}        isRatio />
              </div>
            </section>

            {/* ── Historical charts ──────────────────────────────────── */}
            <section style={{ marginBottom: 40 }}>
              <HistoricalChartsSection />
            </section>

            {/* ── OI by underlying ──────────────────────────────────── */}
            <section style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 12 }}>
                Open Interest Breakdown
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)", marginBottom: 14 }}>By Underlying</div>
                  <div style={{ overflowX: "auto" }}>
                    <OiBarChart buckets={stats.oi_by_bucket} groupBy="underlying" width={460} />
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, background: "var(--call)", opacity: 0.75 }} />
                      <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Calls</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, background: "var(--put)", opacity: 0.75 }} />
                      <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Puts</span>
                    </div>
                  </div>
                </div>
                <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "16px 20px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)", marginBottom: 14 }}>By Expiry</div>
                  <div style={{ overflowX: "auto" }}>
                    <OiBarChart buckets={stats.oi_by_bucket} groupBy="expiry" width={460} />
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, background: "var(--call)", opacity: 0.75 }} />
                      <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Calls</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, background: "var(--put)", opacity: 0.75 }} />
                      <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Puts</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Put/call ratio by underlying ──────────────────────── */}
            <section style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 12 }}>
                Put / Call Ratio by Underlying
              </div>
              <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "16px 20px" }}>
                <PcRatioByUnderlying buckets={stats.oi_by_bucket} />
              </div>
            </section>

            {/* ── OI by strike + max-pain ────────────────────────────── */}
            <section style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)" }}>
                  OI by Strike &amp; Max Pain · 30D
                </div>
                {/* Underlying selector */}
                <div style={{ display: "flex", gap: 2 }}>
                  {underlyings.map(u => (
                    <button key={u} onClick={() => setSelectedUnderlying(u)} style={{ padding: "4px 10px", border: "none", background: selectedUnderlying === u ? "var(--brand-dim)" : "var(--bg-overlay)", color: selectedUnderlying === u ? "var(--brand)" : "var(--text-lo)", fontSize: 10, cursor: "pointer", fontFamily: "var(--font-mono)" }}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "16px 20px" }}>
                {selectedMaxPain ? (
                  <>
                    <div style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 12 }}>
                      {selectedMaxPain.underlying} · Max Pain:{" "}
                      <span className="num" style={{ fontWeight: 600, color: "var(--atm)" }}>
                        {selectedMaxPain.max_pain_strike >= 1000
                          ? selectedMaxPain.max_pain_strike.toLocaleString("en-US")
                          : selectedMaxPain.max_pain_strike.toFixed(4)}
                      </span>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <MaxPainChart data={selectedMaxPain} width={600} height={150} />
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 8, height: 8, background: "var(--call)", opacity: 0.7 }} />
                        <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Call OI</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 8, height: 8, background: "var(--put)", opacity: 0.7 }} />
                        <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Put OI</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 24, height: 1, background: "var(--atm)", borderTop: "1px dashed var(--atm)" }} />
                        <span style={{ fontSize: 10, color: "var(--text-lo)" }}>Max Pain strike</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: "40px 0", textAlign: "center", fontSize: 12, color: "var(--text-lo)" }}>No data for {selectedUnderlying}</div>
                )}
              </div>
            </section>

            {/* ── OI bucket table ───────────────────────────────────── */}
            <section style={{ marginBottom: 40 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-lo)", marginBottom: 12 }}>
                OI Breakdown by Underlying × Expiry
              </div>
              <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                      {["Underlying", "Expiry", "Call OI", "Put OI", "Total OI", "P/C Ratio"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-overlay)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.oi_by_bucket
                      .sort((a, b) => b.total_oi - a.total_oi)
                      .map((b, i) => (
                        <tr key={`${b.underlying}-${b.expiry_days}`} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-hi)", textAlign: "right" }}>{b.underlying}</td>
                          <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-mid)", textAlign: "right" }}>{b.expiry_days}D</td>
                          <td className="num" style={{ padding: "8px 12px", fontSize: 11, textAlign: "right", color: "var(--call)" }}>{fmtUSD(b.call_oi)}</td>
                          <td className="num" style={{ padding: "8px 12px", fontSize: 11, textAlign: "right", color: "var(--put)" }}>{fmtUSD(b.put_oi)}</td>
                          <td className="num" style={{ padding: "8px 12px", fontSize: 11, textAlign: "right", color: "var(--text-hi)" }}>{fmtUSD(b.total_oi)}</td>
                          <td className="num" style={{ padding: "8px 12px", fontSize: 11, textAlign: "right", fontWeight: 600, color: b.put_call_ratio > 1 ? "var(--put)" : "var(--call)" }}>
                            {b.put_call_ratio.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Embed widget hint ─────────────────────────────────── */}
            <section>
              <div style={{ padding: "16px 20px", border: "1px solid var(--border-subtle)", background: "var(--bg-raised)" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 8 }}>Embed</div>
                <p style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 10 }}>
                  Charts can be embedded in external pages via the <code style={{ fontFamily: "var(--font-mono)", color: "var(--brand)" }}>/stats/embed</code> route, which renders without the nav shell and sets a permissive <code style={{ fontFamily: "var(--font-mono)", color: "var(--brand)" }}>frame-ancestors</code> CSP header scoped only to that route.
                </p>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "8px 12px", background: "var(--bg-overlay)", color: "var(--text-mid)" }}>
                  {'<iframe src="https://app.zenith.finance/stats/embed" width="700" height="420" frameborder="0" />'}
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--border-subtle)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-lo)" }}>Zenith Protocol · Public Analytics · Stellar Soroban</span>
          <div style={{ display: "flex", gap: 20 }}>
            {[["GitHub", "https://github.com/Zenith-options"], ["Docs", "#"]].map(([l, href]) => (
              <a key={l} href={href} style={{ fontSize: 12, color: "var(--text-lo)", textDecoration: "none" }}>{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
