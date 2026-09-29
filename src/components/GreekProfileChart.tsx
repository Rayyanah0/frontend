/**
 * GreekProfileChart — Issue #64.
 *
 * SVG line chart for Δ(S), Γ(S), V(S) profiles computed by the quant worker.
 * Shows the Greek value (y-axis) as spot moves across ±30% from current (x-axis).
 * A vertical line marks the current spot. Zero-crossing is rendered as a thin axis.
 */
"use client";

import type { ProfilePoint, GreekKey } from "../lib/quantWorker";

const GREEK_META: Record<GreekKey, { label: string; color: string; fmt: (v: number) => string }> = {
  delta: { label: "Δ Delta", color: "var(--brand)", fmt: v => v.toFixed(3) },
  gamma: { label: "Γ Gamma", color: "var(--call)", fmt: v => v.toFixed(4) },
  vega:  { label: "ν Vega",  color: "#7B9EC9", fmt: v => v.toFixed(3) },
};

interface Props {
  profile: ProfilePoint[];
  greek: GreekKey;
  currentSpot: number;
  width?: number;
  height?: number;
}

function toPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function GreekProfileChart({ profile, greek, currentSpot, width = 440, height = 180 }: Props) {
  const meta = GREEK_META[greek];
  const pad = { top: 16, right: 16, bottom: 28, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (profile.length === 0) {
    return (
      <svg width={width} height={height}>
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="var(--text-lo)" fontSize={11}>
          No positions
        </text>
      </svg>
    );
  }

  const values = profile.map(p => p[greek]);
  const spots  = profile.map(p => p.spot);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV || 1;
  const minS = Math.min(...spots);
  const maxS = Math.max(...spots);
  const sRange = maxS - minS || 1;

  const toX = (s: number) => pad.left + ((s - minS) / sRange) * innerW;
  const toY = (v: number) => pad.top + ((maxV - v) / vRange) * innerH;

  const linePoints = profile.map(p => ({ x: toX(p.spot), y: toY(p[greek]) }));
  const linePath = toPath(linePoints);

  // Fill path (area under curve toward zero line)
  const zeroY = toY(0);
  const clampedZeroY = Math.max(pad.top, Math.min(pad.top + innerH, zeroY));
  const fillPath = `${linePath} L${(pad.left + innerW).toFixed(1)},${clampedZeroY.toFixed(1)} L${pad.left.toFixed(1)},${clampedZeroY.toFixed(1)} Z`;

  // Current spot line
  const currentX = toX(currentSpot);

  // Y-axis tick labels (3 ticks: min, 0, max)
  const yTicks = [maxV, 0, minV].filter((v, i, arr) => {
    // Don't draw 0 if it's very close to min or max
    if (v === 0 && (Math.abs(maxV) < vRange * 0.05 || Math.abs(minV) < vRange * 0.05)) return false;
    return arr.indexOf(v) === i;
  });

  // X-axis tick labels: -30%, -15%, 0%, +15%, +30%
  const xTicks = [-0.30, -0.15, 0, 0.15, 0.30].map(offset => ({
    spot: currentSpot * (1 + offset),
    label: offset === 0 ? "0%" : `${offset > 0 ? "+" : ""}${(offset * 100).toFixed(0)}%`,
  }));

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      {/* Zero line */}
      {minV < 0 && maxV > 0 && (
        <line
          x1={pad.left} y1={clampedZeroY}
          x2={pad.left + innerW} y2={clampedZeroY}
          stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3,3"
        />
      )}

      {/* Fill */}
      <path d={fillPath} fill={meta.color} opacity={0.12} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={meta.color} strokeWidth={1.5} strokeLinejoin="round" />

      {/* Current spot vertical */}
      <line
        x1={currentX.toFixed(1)} y1={pad.top}
        x2={currentX.toFixed(1)} y2={pad.top + innerH}
        stroke="var(--atm)" strokeWidth={1} strokeDasharray="4,3"
      />
      <text x={currentX} y={pad.top - 2} textAnchor="middle" fontSize={9} fill="var(--atm)">
        spot
      </text>

      {/* Y-axis ticks */}
      {yTicks.map(v => (
        <g key={v}>
          <line
            x1={pad.left - 3} y1={toY(v)}
            x2={pad.left} y2={toY(v)}
            stroke="var(--border-default)" strokeWidth={1}
          />
          <text
            x={pad.left - 5} y={toY(v) + 3}
            textAnchor="end" fontSize={9}
            fontFamily="var(--font-mono)"
            fill="var(--text-lo)"
          >
            {meta.fmt(v)}
          </text>
        </g>
      ))}

      {/* X-axis ticks */}
      {xTicks.map(t => {
        const x = toX(t.spot);
        if (x < pad.left || x > pad.left + innerW) return null;
        return (
          <g key={t.label}>
            <line
              x1={x} y1={pad.top + innerH}
              x2={x} y2={pad.top + innerH + 3}
              stroke="var(--border-default)" strokeWidth={1}
            />
            <text
              x={x} y={pad.top + innerH + 12}
              textAnchor="middle" fontSize={9}
              fontFamily="var(--font-mono)"
              fill="var(--text-lo)"
            >
              {t.label}
            </text>
          </g>
        );
      })}

      {/* Border box */}
      <rect
        x={pad.left} y={pad.top}
        width={innerW} height={innerH}
        fill="none" stroke="var(--border-subtle)" strokeWidth={1}
      />

      {/* Label */}
      <text x={pad.left + 6} y={pad.top + 13} fontSize={10} fill={meta.color} fontWeight={600}>
        {meta.label}
      </text>
    </svg>
  );
}
