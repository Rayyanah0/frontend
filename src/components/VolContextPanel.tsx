"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchVolContext } from "../lib/api/volContext";
import { ivRank, ivPercentile, realizedVolCone, ivRvSpread } from "../lib/volContext";

const CONE_WINDOWS = [10, 30, 60, 90];

interface Props {
  underlying: string;
  /** Current ATM IV from the live feed (used to refresh IVR/IVP on each tick). */
  currentIv: number;
}

function gauge(value: number, color: string) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div style={{ width: "100%", height: 4, background: "var(--bg-overlay)", borderRadius: 0, overflow: "hidden" }}>
      <div style={{
        width: `${clamped}%`, height: "100%",
        background: color, transition: "width 400ms",
      }} />
    </div>
  );
}

function pct(v: number | null) {
  if (v === null) return "—";
  return `${v.toFixed(1)}%`;
}

function volPct(v: number | null) {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/** Tiny inline SVG line chart — renders an IV-vs-time sparkline. */
function Sparkline({
  values,
  current,
  width = 220,
  height = 48,
  color = "var(--atm)",
}: {
  values: number[];
  current: number;
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values, current);
  const max = Math.max(...values, current);
  const range = max - min || 0.01;
  const pts = [...values, current];
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * width);
  const ys = pts.map(v => height - ((v - min) / range) * (height - 4) - 2);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  // Highlight the rightmost point (current IV)
  const cx = xs[xs.length - 1];
  const cy = ys[ys.length - 1];
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" opacity={0.7} />
      <circle cx={cx} cy={cy} r={2.5} fill={color} />
    </svg>
  );
}

/**
 * Realized-vol cone chart — draws the min/p25-p75 band/max cone for each
 * time window, plus the current IV overlaid as a dot to show richness.
 */
function VolConeChart({
  conePoints,
  ivSpread,
  width = 300,
  height = 120,
}: {
  conePoints: ReturnType<typeof realizedVolCone>;
  ivSpread: ReturnType<typeof ivRvSpread>;
  width?: number;
  height?: number;
}) {
  const allVals = conePoints.flatMap(pt =>
    [pt.min, pt.max, pt.current, ...ivSpread.map(s => s.iv)].filter((v): v is number => v !== null)
  );
  if (allVals.length === 0) return null;
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const range = maxV - minV || 0.01;
  const pad = { top: 8, right: 8, bottom: 24, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const xStep = innerW / (conePoints.length - 1 || 1);
  const toY = (v: number) => pad.top + innerH - ((v - minV) / range) * innerH;
  const toX = (i: number) => pad.left + i * xStep;

  // IV curve path
  const ivPath = ivSpread
    .map((s, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(s.iv).toFixed(1)}`)
    .join(" ");

  // Band polygon (p25–p75)
  const bandTopPath = conePoints
    .filter(pt => pt.p75 !== null)
    .map((pt, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(pt.p75!).toFixed(1)}`)
    .join(" ");
  const bandBotPath = conePoints
    .filter(pt => pt.p25 !== null)
    .map((pt, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(pt.p25!).toFixed(1)}`)
    .join(" ");
  // close the polygon
  const bandPoly = bandTopPath +
    " " +
    conePoints.filter(pt => pt.p25 !== null).map((pt, i, arr) =>
      `${i === arr.length - 1 ? "L" : "L"}${toX(arr.length - 1 - i + (conePoints.length - arr.length)).toFixed(1)},${toY(pt.p25!).toFixed(1)}`
    ).reverse().join(" ") + " Z";

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      {/* Y-axis labels */}
      {[0, 0.5, 1].map(t => {
        const v = minV + t * range;
        const y = toY(v);
        return (
          <text key={t} x={pad.left - 4} y={y + 3} textAnchor="end"
            style={{ fontSize: 8, fontFamily: "var(--font-mono)", fill: "var(--text-lo)" }}>
            {(v * 100).toFixed(0)}%
          </text>
        );
      })}

      {/* p25–p75 band */}
      <path d={bandPoly} fill="rgba(181,150,101,0.10)" stroke="none" />

      {/* Min/max whiskers */}
      {conePoints.map((pt, i) => {
        if (pt.min === null || pt.max === null) return null;
        const x = toX(i);
        return (
          <line key={i} x1={x} y1={toY(pt.max)} x2={x} y2={toY(pt.min)}
            stroke="rgba(181,150,101,0.25)" strokeWidth={1} />
        );
      })}

      {/* Median line */}
      <path
        d={conePoints.filter(pt => pt.median !== null).map((pt, i) =>
          `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(pt.median!).toFixed(1)}`
        ).join(" ")}
        fill="none" stroke="rgba(181,150,101,0.50)" strokeWidth={1} strokeDasharray="3 2"
      />

      {/* IV overlay (current ATM IV per term) */}
      <path d={ivPath} fill="none" stroke="var(--atm)" strokeWidth={1.5} strokeLinejoin="round" />
      {ivSpread.map((s, i) => (
        <circle key={i} cx={toX(i)} cy={toY(s.iv)} r={2.5}
          fill={s.spread !== null && s.spread > 0 ? "var(--put)" : "var(--call)"}
          stroke="var(--bg)" strokeWidth={1} />
      ))}

      {/* X-axis labels */}
      {conePoints.map((pt, i) => (
        <text key={pt.days} x={toX(i)} y={height - 4} textAnchor="middle"
          style={{ fontSize: 8, fontFamily: "var(--font-mono)", fill: "var(--text-lo)" }}>
          {pt.days}D
        </text>
      ))}
    </svg>
  );
}

/**
 * VolContextPanel — shows IV rank, IV percentile, a realized-vol cone, and an
 * IV-vs-RV spread chart for the selected underlying.
 *
 * Feature-flagged via NEXT_PUBLIC_VOL_CONTEXT: defaults to "mock" until the
 * backend endpoint is available.
 */
export function VolContextPanel({ underlying, currentIv }: Props) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchVolContext>> | null>(null);
  const [loading, setLoading] = useState(true);
  const prevIvRef = useRef(currentIv);

  // Reload data when the underlying changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchVolContext(underlying, currentIv).then(d => {
      if (!cancelled) { setData(d); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlying]);

  // Update currentIv in the data whenever the live feed ticks, without
  // re-fetching the whole history — the history is the expensive part.
  useEffect(() => {
    if (!data || currentIv === prevIvRef.current) return;
    prevIvRef.current = currentIv;
    setData(prev => prev ? { ...prev, currentIv } : prev);
  }, [currentIv, data]);

  const rank = useMemo(
    () => data ? ivRank(data.currentIv, data.ivHistory) : null,
    [data]
  );
  const percentile = useMemo(
    () => data ? ivPercentile(data.currentIv, data.ivHistory) : null,
    [data]
  );
  const conePoints = useMemo(
    () => data ? realizedVolCone(data.closes, CONE_WINDOWS) : [],
    [data]
  );
  // Simple flat-term IV: use the current spot ATM IV for every term (a
  // term-structure model can be wired in later once backend delivers it).
  const ivSpread = useMemo(
    () => data ? ivRvSpread(conePoints, () => data.currentIv) : [],
    [data, conePoints]
  );

  // Gauge color: red → yellow → green from low→mid→high
  function rankColor(v: number | null) {
    if (v === null) return "var(--text-lo)";
    if (v >= 66) return "var(--put)";    // expensive
    if (v >= 33) return "var(--atm)";   // average
    return "var(--call)";               // cheap
  }

  if (loading) {
    return (
      <div style={{ padding: "16px", border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
        <div className="skeleton" style={{ height: 12, width: 120, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 80, width: "100%" }} />
      </div>
    );
  }

  if (!data) return null;

  const ivRankColor = rankColor(rank);

  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 16px", borderBottom: "1px solid var(--border-default)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>
          Volatility Context · {underlying}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-lo)", fontStyle: "italic" }}>
          {process.env.NEXT_PUBLIC_VOL_CONTEXT === "live" ? "live" : "mock data"}
        </div>
      </div>

      <div style={{ padding: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* Left column: gauges + sparkline */}
        <div style={{ minWidth: 200, flex: "0 0 220px" }}>
          {/* ATM IV */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-lo)" }}>
                ATM IV
              </span>
              <span className="num" style={{ fontSize: 13, fontWeight: 700, color: "var(--atm)" }}>
                {(data.currentIv * 100).toFixed(1)}%
              </span>
            </div>
            {/* 52-week sparkline */}
            <Sparkline values={data.ivHistory} current={data.currentIv} width={220} height={44} />
          </div>

          {/* IV Rank */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-lo)" }}>
                IV Rank (52W)
              </span>
              <span className="num" style={{ fontSize: 13, fontWeight: 700, color: ivRankColor }}>
                {pct(rank)}
              </span>
            </div>
            {gauge(rank ?? 0, ivRankColor)}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
              <span style={{ fontSize: 8, color: "var(--text-lo)" }}>Low</span>
              <span style={{ fontSize: 8, color: "var(--text-lo)" }}>High</span>
            </div>
          </div>

          {/* IV Percentile */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-lo)" }}>
                IV Percentile (252D)
              </span>
              <span className="num" style={{ fontSize: 13, fontWeight: 700, color: rankColor(percentile) }}>
                {pct(percentile)}
              </span>
            </div>
            {gauge(percentile ?? 0, rankColor(percentile))}
          </div>

          {/* Rich / Cheap label */}
          {rank !== null && (
            <div style={{
              marginTop: 8,
              padding: "6px 10px",
              background: rank >= 50 ? "var(--put-dim)" : "var(--call-dim)",
              border: `1px solid ${rank >= 50 ? "var(--put)" : "var(--call)"}`,
              fontSize: 11,
              color: rank >= 50 ? "var(--put)" : "var(--call)",
            }}>
              {rank >= 66 ? "Options are expensive (rich IV)" :
               rank >= 33 ? "Options near historical average" :
                            "Options are cheap (low IV)"}
              {" · "}
              {rank >= 50 ? "Writing favored" : "Buying favored"}
            </div>
          )}
        </div>

        {/* Right column: vol cone + IV vs RV table */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 8 }}>
            Realized Vol Cone · IV overlay
          </div>
          <VolConeChart conePoints={conePoints} ivSpread={ivSpread} width={300} height={130} />

          {/* IV vs RV spread table */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6 }}>
              IV vs RV Spread
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Term", "ATM IV", "RV (current)", "Spread", "Bias"].map(h => (
                    <th key={h} style={{
                      fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em",
                      color: "var(--text-lo)", padding: "2px 6px", textAlign: "right",
                      fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ivSpread.map(row => {
                  const spread = row.spread;
                  const spreadColor = spread === null ? "var(--text-lo)"
                    : spread > 0.02 ? "var(--put)"
                    : spread < -0.02 ? "var(--call)"
                    : "var(--atm)";
                  return (
                    <tr key={row.days} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                      <td className="num" style={{ padding: "4px 6px", fontSize: 10, color: "var(--text-lo)", textAlign: "right" }}>
                        {row.days}D
                      </td>
                      <td className="num" style={{ padding: "4px 6px", fontSize: 11, color: "var(--atm)", textAlign: "right" }}>
                        {volPct(row.iv)}
                      </td>
                      <td className="num" style={{ padding: "4px 6px", fontSize: 11, color: "var(--text-hi)", textAlign: "right" }}>
                        {volPct(row.rv)}
                      </td>
                      <td className="num" style={{ padding: "4px 6px", fontSize: 11, fontWeight: 600, color: spreadColor, textAlign: "right" }}>
                        {spread !== null
                          ? `${spread >= 0 ? "+" : ""}${(spread * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td style={{ padding: "4px 6px", fontSize: 9, color: spreadColor, textAlign: "right" }}>
                        {spread === null ? "—"
                          : spread > 0.02 ? "Rich"
                          : spread < -0.02 ? "Cheap"
                          : "Fair"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cone legend */}
          <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
            {[
              { symbol: "━", color: "var(--atm)", label: "ATM IV" },
              { symbol: "━", color: "rgba(181,150,101,0.5)", label: "Median RV", dashed: true },
              { symbol: "▪", color: "rgba(181,150,101,0.3)", label: "p25–p75 band" },
              { symbol: "│", color: "rgba(181,150,101,0.25)", label: "Min/Max" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  fontSize: item.symbol === "▪" ? 14 : 10,
                  color: item.color,
                  fontFamily: "var(--font-mono)",
                  textDecoration: item.dashed ? "underline" : "none",
                }}>
                  {item.symbol}
                </span>
                <span style={{ fontSize: 9, color: "var(--text-lo)" }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
