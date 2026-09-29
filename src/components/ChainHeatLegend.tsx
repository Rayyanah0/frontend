"use client";

import type { HeatScale } from "../lib/heatScale";

interface Props {
  iv: HeatScale;
  absDelta: HeatScale;
  theta: HeatScale;
  heatMode: HeatMode;
  onChange: (m: HeatMode) => void;
}

export type HeatMode = "off" | "iv" | "delta" | "theta";

function ScaleStrip({ scale, label, kind }: { scale: HeatScale; label: string; kind: "sequential" | "diverging" }) {
  const gradient =
    kind === "diverging"
      ? "linear-gradient(90deg, var(--heat-div-lo), var(--heat-div-mid), var(--heat-div-hi))"
      : "linear-gradient(90deg, var(--heat-seq-lo), var(--heat-seq-hi))";
  const fmt = (v: number) =>
    Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 9, color: "var(--text-lo)", minWidth: 36 }}>{label}</span>
      <span className="num" style={{ fontSize: 9, color: "var(--text-lo)" }}>{fmt(scale.min)}</span>
      <div style={{ width: 72, height: 6, background: gradient }} aria-hidden />
      <span className="num" style={{ fontSize: 9, color: "var(--text-lo)" }}>{fmt(scale.max)}</span>
    </div>
  );
}

export function ChainHeatLegend({ iv, absDelta, theta, heatMode, onChange }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "6px 10px",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--bg-raised)",
      }}
    >
      <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)" }}>
        Heat
      </span>
      {([
        ["off", "Off"],
        ["iv", "IV"],
        ["delta", "|Δ|"],
        ["theta", "Θ"],
      ] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={heatMode === id}
          style={{
            padding: "2px 8px",
            border: "1px solid var(--border-default)",
            background: heatMode === id ? "var(--atm-dim)" : "transparent",
            color: heatMode === id ? "var(--atm)" : "var(--text-lo)",
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      ))}
      {heatMode === "iv" && <ScaleStrip scale={iv} label="IV" kind="sequential" />}
      {heatMode === "delta" && <ScaleStrip scale={absDelta} label="|Δ|" kind="sequential" />}
      {heatMode === "theta" && <ScaleStrip scale={theta} label="Θ" kind="diverging" />}
      <span style={{ fontSize: 9, color: "var(--text-lo)", marginLeft: "auto" }}>
        Values always shown as text · colorblind-safe palette
      </span>
    </div>
  );
}
