"use client";

/**
 * PositionMtmScenario — renders a mini positions table and collects profiler
 * samples as position mark-to-market ticks are pumped through.
 */

import { memo } from "react";
import { ProfilerWrapper } from "../../../../lib/perf/ProfilerWrapper";
import type { ProfileSample } from "../../../../lib/perf/metrics";
import type { PositionMtmTick } from "../../../../lib/perf/tickScripts";

interface Props {
  positions: PositionMtmTick[] | null;
  onSample: (s: ProfileSample) => void;
}

const PositionRow = memo(function PositionRow({ pos }: { pos: PositionMtmTick }) {
  const pnlColor = pos.unrealizedPnl >= 0 ? "#68d391" : "#fc8181";
  return (
    <div
      data-testid={`pos-row-${pos.id}`}
      style={{ display: "flex", gap: 12, padding: "4px 0", fontSize: 11 }}
    >
      <span style={{ width: 50 }}>{pos.symbol}</span>
      <span style={{ width: 60 }}>{pos.type}/{pos.side[0]}</span>
      <span style={{ width: 70 }}>{pos.strike.toLocaleString()}</span>
      <span style={{ width: 60 }}>{pos.currentPrice.toFixed(2)}</span>
      <span style={{ width: 80, color: pnlColor }}>
        {pos.unrealizedPnl >= 0 ? "+" : ""}
        {pos.unrealizedPnl.toFixed(2)}
      </span>
    </div>
  );
});

const PositionsDisplay = memo(function PositionsDisplay({
  positions,
}: {
  positions: PositionMtmTick[] | null;
}) {
  if (!positions || positions.length === 0) return <div data-testid="mtm-empty">—</div>;
  return (
    <div data-testid="mtm-display">
      {positions.map((pos) => (
        <PositionRow key={pos.id} pos={pos} />
      ))}
    </div>
  );
});

export function PositionMtmScenario({ positions, onSample }: Props) {
  return (
    <ProfilerWrapper id="position-mtm" onSample={onSample}>
      <PositionsDisplay positions={positions} />
    </ProfilerWrapper>
  );
}
