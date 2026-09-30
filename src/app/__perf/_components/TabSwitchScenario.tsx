"use client";

/**
 * TabSwitchScenario — renders a tabbed panel and collects profiler samples
 * as tabs are switched in the harness sequence.
 */

import { ProfilerWrapper } from "../../../../lib/perf/ProfilerWrapper";
import type { ProfileSample } from "../../../../lib/perf/metrics";
import type { TabName } from "../../../../lib/perf/tickScripts";

interface Props {
  activeTab: TabName;
  onSample: (s: ProfileSample) => void;
}

const TAB_CONTENT: Record<TabName, string> = {
  chain: "Options Chain — 21 strikes, 2 expiries",
  positions: "Positions — live MTM, greeks, PnL",
  strategies: "Strategies — multi-leg builder, payoff",
  surface: "Vol Surface — IV heatmap, term structure",
};

function TabPanel({ activeTab }: { activeTab: TabName }) {
  return (
    <div data-testid="tab-panel">
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {(["chain", "positions", "strategies", "surface"] as TabName[]).map((t) => (
          <span
            key={t}
            data-testid={`tab-${t}`}
            style={{
              padding: "3px 8px",
              fontSize: 11,
              borderRadius: 4,
              background: t === activeTab ? "#3182ce" : "#2d3748",
              color: t === activeTab ? "#fff" : "#718096",
            }}
          >
            {t}
          </span>
        ))}
      </div>
      <div data-testid="tab-content" style={{ fontSize: 11, color: "#a0aec0" }}>
        {TAB_CONTENT[activeTab]}
      </div>
    </div>
  );
}

export function TabSwitchScenario({ activeTab, onSample }: Props) {
  return (
    <ProfilerWrapper id="tab-switch" onSample={onSample}>
      <TabPanel activeTab={activeTab} />
    </ProfilerWrapper>
  );
}
