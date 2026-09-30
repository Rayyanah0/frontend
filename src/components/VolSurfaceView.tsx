"use client";

import dynamic from "next/dynamic";
import { Suspense, useState } from "react";
import { VolSurfaceHeatmap } from "./VolSurfaceHeatmap";

const VolSurface3D = dynamic(
  () => import("./VolSurface3D").then(m => m.VolSurface3D),
  {
    ssr: false,
    loading: () => (
      <div style={{ padding: 24, fontSize: 12, color: "var(--text-lo)" }}>Loading 3D surface…</div>
    ),
  }
);

interface Props {
  baseVol: number;
  selectedExpiryDays?: number;
  onSelectStrike?: (moneyness: number, days: number, iv: number) => void;
}

/** Surface tab host: lazy-loads the WebGL view; falls back to the 2D heatmap. */
export function VolSurfaceView({ baseVol, selectedExpiryDays, onSelectStrike }: Props) {
  const [mode, setMode] = useState<"3d" | "2d">("3d");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["3d", "2d"] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              padding: "4px 12px",
              border: "1px solid var(--border-default)",
              cursor: "pointer",
              fontSize: 11,
              background: mode === m ? "var(--atm-dim)" : "transparent",
              color: mode === m ? "var(--atm)" : "var(--text-lo)",
            }}
          >
            {m === "3d" ? "3D Surface" : "Heatmap"}
          </button>
        ))}
      </div>
      {mode === "3d" ? (
        <Suspense fallback={<div style={{ fontSize: 12, color: "var(--text-lo)" }}>Loading…</div>}>
          <VolSurface3D
            baseVol={baseVol}
            selectedExpiryDays={selectedExpiryDays}
            onSelectStrike={onSelectStrike}
          />
        </Suspense>
      ) : (
        <VolSurfaceHeatmap baseVol={baseVol} selectedExpiryDays={selectedExpiryDays} />
      )}
    </div>
  );
}
