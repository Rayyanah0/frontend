"use client";

/**
 * SpotTickScenario — renders a SpotFeed-style display and collects profiler
 * samples as spot price ticks are pumped in by the harness.
 */

import { ProfilerWrapper } from "../../../../lib/perf/ProfilerWrapper";
import type { ProfileSample } from "../../../../lib/perf/metrics";
import type { SpotTickPayload } from "../../../../lib/perf/tickScripts";

interface Props {
  tick: SpotTickPayload | null;
  onSample: (s: ProfileSample) => void;
}

function SpotTickDisplay({ tick }: { tick: SpotTickPayload | null }) {
  if (!tick) return <div data-testid="spot-tick-empty">—</div>;
  return (
    <div data-testid="spot-tick-display" style={{ fontFamily: "monospace", fontSize: 12 }}>
      {Object.entries(tick.prices).map(([sym, price]) => (
        <div key={sym}>
          <span>{sym}</span>{" "}
          <span>{price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>{" "}
          <span style={{ color: "#718096" }}>vol={((tick.vols[sym] ?? 0) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

export function SpotTickScenario({ tick, onSample }: Props) {
  return (
    <ProfilerWrapper id="spot-tick" onSample={onSample}>
      <SpotTickDisplay tick={tick} />
    </ProfilerWrapper>
  );
}
