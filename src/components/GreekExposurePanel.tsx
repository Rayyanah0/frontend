/**
 * GreekExposurePanel — Issue #64.
 *
 * Portfolio Greek exposure: Δ/Γ/ν profiles across ±30% spot + exposure
 * heatmap by expiry × strike, per underlying. Computed by the quant worker.
 *
 * In dev mode, shows a consistency check between local computation and
 * the backend's aggregate Greeks at current spot.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Position, AggregateGreeks } from "../lib/api/types";
import { MARKETS } from "../lib/pricing";
import { groupPositionsByUnderlying } from "../lib/risk";
import { useQuantWorker } from "../lib/useQuantWorker";
import { GreekProfileChart } from "./GreekProfileChart";
import { GreekExposureHeatmap } from "./GreekExposureHeatmap";
import type { GreekKey } from "../lib/quantWorker";

const GREEK_KEYS: GreekKey[] = ["delta", "gamma", "vega"];
const GREEK_LABELS: Record<GreekKey, string> = { delta: "Δ", gamma: "Γ", vega: "ν" };

interface Props {
  positions: Position[];
  spots: Record<string, number>;
  vols: Record<string, number>;
  /** Backend aggregate Greeks for consistency check (dev-only) */
  backendGreeks?: AggregateGreeks | null;
}

const TOL = 0.05; // 5% tolerance for dev consistency check

export function GreekExposurePanel({ positions, spots, vols, backendGreeks }: Props) {
  const groups = useMemo(() => groupPositionsByUnderlying(positions), [positions]);
  const underlyings = useMemo(() => Array.from(groups.keys()).sort(), [groups]);
  const [selectedUnderlying, setSelectedUnderlying] = useState<string>("");
  const [activeGreek, setActiveGreek] = useState<GreekKey>("delta");

  // Keep selectedUnderlying in sync with available underlyings
  useEffect(() => {
    if (!underlyings.includes(selectedUnderlying) && underlyings.length > 0) {
      setSelectedUnderlying(underlyings[0]);
    }
  }, [underlyings, selectedUnderlying]);

  const activeUnderlying = underlyings.includes(selectedUnderlying) ? selectedUnderlying : underlyings[0];
  const activePositions = useMemo(() => groups.get(activeUnderlying) ?? [], [groups, activeUnderlying]);
  const currentSpot = spots[activeUnderlying] ?? MARKETS.find(m => m.sym === activeUnderlying)?.price ?? 0;
  const baseVol = vols[activeUnderlying] ?? MARKETS.find(m => m.sym === activeUnderlying)?.vol ?? 0.5;

  const { result, loading, compute } = useQuantWorker();

  // Recompute whenever key inputs change
  useEffect(() => {
    if (activeUnderlying && activePositions.length > 0 && currentSpot > 0) {
      compute(activeUnderlying, activePositions, currentSpot, baseVol, activeGreek);
    }
  }, [activeUnderlying, activePositions, currentSpot, baseVol, activeGreek, compute]);

  if (underlyings.length === 0) return null;

  // Dev consistency check: compare local at-spot Greeks vs backend aggregate
  const isDev = process.env.NODE_ENV === "development";
  const check = result?.atSpotCheck;
  const backendDelta = backendGreeks?.delta;
  const backendGamma = backendGreeks?.gamma;
  const backendVega = backendGreeks?.vega;
  const deltaOk = check && backendDelta != null
    ? Math.abs(check.delta - backendDelta) <= Math.abs(backendDelta) * TOL + 0.001
    : null;
  const gammaOk = check && backendGamma != null
    ? Math.abs(check.gamma - backendGamma) <= Math.abs(backendGamma) * TOL + 0.0001
    : null;

  return (
    <div style={{
      border: "1px solid var(--border-default)",
      background: "var(--bg-raised)",
      marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 16px", borderBottom: "1px solid var(--border-default)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>
          Greek Exposure
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Underlying selector */}
          <div style={{ display: "flex", gap: 2 }}>
            {underlyings.map(u => (
              <button
                key={u}
                onClick={() => setSelectedUnderlying(u)}
                aria-pressed={activeUnderlying === u}
                style={{
                  padding: "3px 10px", border: "none", cursor: "pointer", fontSize: 11,
                  background: activeUnderlying === u ? "var(--atm-dim)" : "transparent",
                  color: activeUnderlying === u ? "var(--atm)" : "var(--text-lo)",
                }}
              >
                {u}
              </button>
            ))}
          </div>
          <div style={{ width: 1, background: "var(--border-subtle)" }} />
          {/* Greek selector */}
          <div style={{ display: "flex", gap: 2 }}>
            {GREEK_KEYS.map(g => (
              <button
                key={g}
                onClick={() => setActiveGreek(g)}
                aria-pressed={activeGreek === g}
                style={{
                  padding: "3px 8px", border: "none", cursor: "pointer", fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  background: activeGreek === g ? "var(--brand-dim)" : "transparent",
                  color: activeGreek === g ? "var(--brand)" : "var(--text-lo)",
                }}
              >
                {GREEK_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ padding: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <div className="skeleton" style={{ width: 440, height: 180 }} />
        </div>
      )}

      {!loading && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {/* Profile curves: Δ, Γ, ν side by side */}
          <div style={{
            padding: "12px 16px",
            display: "flex", gap: 16, flexWrap: "wrap",
            borderBottom: "1px solid var(--border-default)",
          }}>
            {GREEK_KEYS.map(g => (
              <div key={g} style={{ flex: "1 1 280px" }}>
                <GreekProfileChart
                  profile={result.profile}
                  greek={g}
                  currentSpot={result.currentSpot}
                  width={300}
                  height={160}
                />
              </div>
            ))}
          </div>

          {/* Heatmap */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)" }}>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 8 }}>
              {GREEK_LABELS[activeGreek]} exposure by expiry × strike bucket · click a cell to see positions
            </div>
            <GreekExposureHeatmap
              heatmap={result.heatmap}
              greek={activeGreek}
              positions={activePositions}
            />
          </div>

          {/* Dev consistency check */}
          {isDev && check && (backendDelta != null || backendGamma != null) && (
            <div style={{
              padding: "8px 16px",
              background: "var(--bg-elevated)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
            }}>
              <span style={{ color: "var(--text-lo)", marginRight: 8 }}>
                [dev] at-spot consistency:
              </span>
              <span style={{ color: deltaOk === null ? "var(--text-lo)" : deltaOk ? "var(--call)" : "var(--put)", marginRight: 12 }}>
                Δ local={check.delta.toFixed(4)} backend={backendDelta?.toFixed(4) ?? "—"}
                {deltaOk !== null && (deltaOk ? " ✓" : " ✗")}
              </span>
              <span style={{ color: gammaOk === null ? "var(--text-lo)" : gammaOk ? "var(--call)" : "var(--put)" }}>
                Γ local={check.gamma.toFixed(5)} backend={backendGamma?.toFixed(5) ?? "—"}
                {gammaOk !== null && (gammaOk ? " ✓" : " ✗")}
              </span>
            </div>
          )}
        </div>
      )}

      {!loading && !result && activePositions.length > 0 && (
        <div style={{ padding: 16, color: "var(--text-lo)", fontSize: 12 }}>
          No profile computed yet.
        </div>
      )}
    </div>
  );
}
