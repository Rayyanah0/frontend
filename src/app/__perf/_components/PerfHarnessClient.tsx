"use client";

/**
 * PerfHarnessClient — interactive benchmark UI.
 *
 * Renders a suite of scenario runners that drive real components through
 * scripted tick sequences. Each scenario uses React <Profiler> to collect
 * commit-level timings, PerformanceObserver to detect long tasks, then
 * aggregates the results for display and JSON export.
 */

import { useCallback, useReducer, useRef, useState } from "react";
import {
  aggregateSamples,
  buildReport,
  type PerfReport,
  type ProfileSample,
  type ScenarioResult,
} from "../../../lib/perf/metrics";
import { exportJson, startLongTaskCollection } from "../../../lib/perf/longTasks";
import {
  generateSpotTicks,
  generateChainUpdates,
  generatePositionMtmTicks,
  generateTabSwitches,
  type TabName,
} from "../../../lib/perf/tickScripts";
import { SpotTickScenario } from "./SpotTickScenario";
import { ChainUpdateScenario } from "./ChainUpdateScenario";
import { PositionMtmScenario } from "./PositionMtmScenario";
import { TabSwitchScenario } from "./TabSwitchScenario";

const TICK_INTERVAL_MS = 16; // ~60 fps — one tick per animation frame

// ─── State machine ─────────────────────────────────────────────────────────────
type HarnessStatus = "idle" | "running" | "done" | "error";

interface HarnessState {
  status: HarnessStatus;
  currentScenario: string | null;
  results: ScenarioResult[];
  error: string | null;
}

type HarnessAction =
  | { type: "START" }
  | { type: "SCENARIO_BEGIN"; scenario: string }
  | { type: "SCENARIO_DONE"; result: ScenarioResult }
  | { type: "DONE" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

function reducer(state: HarnessState, action: HarnessAction): HarnessState {
  switch (action.type) {
    case "START":
      return { status: "running", currentScenario: null, results: [], error: null };
    case "SCENARIO_BEGIN":
      return { ...state, currentScenario: action.scenario };
    case "SCENARIO_DONE":
      return { ...state, results: [...state.results, action.result] };
    case "DONE":
      return { ...state, status: "done", currentScenario: null };
    case "ERROR":
      return { ...state, status: "error", error: action.message };
    case "RESET":
      return { status: "idle", currentScenario: null, results: [], error: null };
    default:
      return state;
  }
}

// ─── Scenario runners ──────────────────────────────────────────────────────────
/**
 * Pumps an array of ticks into `setter` at TICK_INTERVAL_MS intervals.
 * Returns a Promise that resolves with the profiler samples collected
 * during the run.
 */
function pumpTicks<T>(
  ticks: T[],
  setter: (tick: T) => void,
  sampleCollector: ProfileSample[],
): Promise<ProfileSample[]> {
  return new Promise((resolve) => {
    let i = 0;
    const captured = sampleCollector;
    const interval = setInterval(() => {
      if (i >= ticks.length) {
        clearInterval(interval);
        // Wait one more frame for React to flush the last commit.
        requestAnimationFrame(() => resolve([...captured]));
        return;
      }
      setter(ticks[i++]);
    }, TICK_INTERVAL_MS);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PerfHarnessClient() {
  const [state, dispatch] = useReducer(reducer, {
    status: "idle",
    currentScenario: null,
    results: [],
    error: null,
  });

  // Scenario state setters — scenario components are always mounted so their
  // profiler data starts accumulating as soon as we push ticks in.
  const [spotTick, setSpotTick] = useState<Parameters<typeof SpotTickScenario>[0]["tick"] | null>(null);
  const [chainRows, setChainRows] = useState<Parameters<typeof ChainUpdateScenario>[0]["rows"] | null>(null);
  const [mtmPositions, setMtmPositions] = useState<
    Parameters<typeof PositionMtmScenario>[0]["positions"] | null
  >(null);
  const [activeTab, setActiveTab] = useState<TabName>("chain");

  // Per-scenario sample buffers — shared via ref so the onSample callback
  // closure always writes to the current buffer without stale captures.
  const samplesRef = useRef<ProfileSample[]>([]);

  const runAll = useCallback(async () => {
    dispatch({ type: "START" });

    // ── 1. Spot tick ──────────────────────────────────────────────────────────
    dispatch({ type: "SCENARIO_BEGIN", scenario: "spot-tick" });
    samplesRef.current = [];
    const spotTicks = generateSpotTicks();
    const ltCollector1 = startLongTaskCollection();
    const t1Start = Date.now();
    await pumpTicks(spotTicks, (tick) => setSpotTick(tick), samplesRef.current);
    const t1End = Date.now();
    const lt1 = ltCollector1.stop();
    dispatch({
      type: "SCENARIO_DONE",
      result: aggregateSamples("spot-tick", samplesRef.current, lt1, t1Start, t1End),
    });

    // ── 2. Chain update ───────────────────────────────────────────────────────
    dispatch({ type: "SCENARIO_BEGIN", scenario: "chain-update" });
    samplesRef.current = [];
    const chainUpdates = generateChainUpdates();
    const ltCollector2 = startLongTaskCollection();
    const t2Start = Date.now();
    await pumpTicks(chainUpdates, (rows) => setChainRows(rows), samplesRef.current);
    const t2End = Date.now();
    const lt2 = ltCollector2.stop();
    dispatch({
      type: "SCENARIO_DONE",
      result: aggregateSamples("chain-update", samplesRef.current, lt2, t2Start, t2End),
    });

    // ── 3. Position MTM ───────────────────────────────────────────────────────
    dispatch({ type: "SCENARIO_BEGIN", scenario: "position-mtm" });
    samplesRef.current = [];
    const mtmTicks = generatePositionMtmTicks();
    const ltCollector3 = startLongTaskCollection();
    const t3Start = Date.now();
    await pumpTicks(mtmTicks, (pos) => setMtmPositions(pos), samplesRef.current);
    const t3End = Date.now();
    const lt3 = ltCollector3.stop();
    dispatch({
      type: "SCENARIO_DONE",
      result: aggregateSamples("position-mtm", samplesRef.current, lt3, t3Start, t3End),
    });

    // ── 4. Tab switch ─────────────────────────────────────────────────────────
    dispatch({ type: "SCENARIO_BEGIN", scenario: "tab-switch" });
    samplesRef.current = [];
    const tabs = generateTabSwitches();
    const ltCollector4 = startLongTaskCollection();
    const t4Start = Date.now();
    await pumpTicks(tabs, (tab) => setActiveTab(tab), samplesRef.current);
    const t4End = Date.now();
    const lt4 = ltCollector4.stop();
    dispatch({
      type: "SCENARIO_DONE",
      result: aggregateSamples("tab-switch", samplesRef.current, lt4, t4Start, t4End),
    });

    dispatch({ type: "DONE" });
  }, []);

  // Expose the latest completed report on window for Playwright tests.
  // useRef to avoid adding results to runAll's deps (keeping it stable).
  const lastExposedStatusRef = useRef<HarnessStatus>("idle");

  // Expose the report on window when the run transitions to "done".
  if (state.status === "done" && lastExposedStatusRef.current !== "done" && typeof window !== "undefined") {
    lastExposedStatusRef.current = "done";
    const report = buildReport(state.results);
    // @ts-expect-error — intentional test hook for Playwright
    (window as unknown as { __perfReport?: unknown }).__perfReport = report;
  }
  if (state.status !== "done") {
    lastExposedStatusRef.current = state.status;
  }

  const handleExport = useCallback(() => {
    const report = buildReport(state.results);
    exportJson(report, `perf-report-${Date.now()}.json`);
  }, [state.results]);

  // Inline sample collector passed down to scenario children.
  const onSample = useCallback((s: ProfileSample) => {
    samplesRef.current.push(s);
  }, []);

  return (
    <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ marginBottom: 24, borderBottom: "1px solid #2d3748", paddingBottom: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#63b3ed", margin: 0 }}>
          ⚡ Zenith Render Performance Harness
        </h1>
        <p style={{ fontSize: 11, color: "#718096", margin: "4px 0 0" }}>
          Dev-only · /__perf · Drives scripted tick sequences through real components
        </p>
      </header>

      <div style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "center" }}>
        <button
          onClick={runAll}
          disabled={state.status === "running"}
          style={btnStyle(state.status === "running" ? "disabled" : "primary")}
          data-testid="run-all-btn"
        >
          {state.status === "running"
            ? `Running: ${state.currentScenario ?? "…"}`
            : state.status === "done"
            ? "▶ Run Again"
            : "▶ Run All Scenarios"}
        </button>

        {state.status === "done" && (
          <>
            <button
              onClick={handleExport}
              style={btnStyle("secondary")}
              data-testid="export-btn"
            >
              ↓ Export JSON
            </button>
            <button
              onClick={() => dispatch({ type: "RESET" })}
              style={btnStyle("ghost")}
            >
              ✕ Reset
            </button>
          </>
        )}

        {state.status === "running" && (
          <span style={{ fontSize: 11, color: "#a0aec0" }}>
            Scenario {state.results.length + 1} / 4
          </span>
        )}
      </div>

      {state.error && (
        <div style={{ background: "#742a2a", padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
          Error: {state.error}
        </div>
      )}

      {/* Results table */}
      {state.results.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 13, color: "#a0aec0", marginBottom: 8 }}>Results</h2>
          <ResultsTable results={state.results} />
        </section>
      )}

      {/* Hidden scenario fixtures — always mounted so Profiler data is collected */}
      <div style={{ display: "none" }} aria-hidden="true" data-testid="scenario-fixtures">
        <SpotTickScenario tick={spotTick} onSample={onSample} />
        <ChainUpdateScenario rows={chainRows} onSample={onSample} />
        <PositionMtmScenario positions={mtmPositions} onSample={onSample} />
        <TabSwitchScenario activeTab={activeTab} onSample={onSample} />
      </div>
    </div>
  );
}

// ─── Results table ────────────────────────────────────────────────────────────
function ResultsTable({ results }: { results: ScenarioResult[] }) {
  const cols: { key: keyof ScenarioResult; label: string; fmt: (v: number) => string }[] = [
    { key: "commitCount", label: "Commits", fmt: (v) => String(v) },
    { key: "totalRenderMs", label: "Total render (ms)", fmt: (v) => v.toFixed(1) },
    { key: "p50RenderMs", label: "p50 (ms)", fmt: (v) => v.toFixed(2) },
    { key: "p95RenderMs", label: "p95 (ms)", fmt: (v) => v.toFixed(2) },
    { key: "totalLongTaskMs", label: "Long tasks (ms)", fmt: (v) => v.toFixed(0) },
  ];

  return (
    <table
      style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
      data-testid="results-table"
    >
      <thead>
        <tr>
          <th style={thStyle}>Scenario</th>
          {cols.map((c) => (
            <th key={c.key} style={thStyle}>
              {c.label}
            </th>
          ))}
          <th style={thStyle}>Duration (ms)</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.scenario} style={{ borderBottom: "1px solid #2d3748" }}>
            <td style={tdStyle}>
              <span style={{ color: "#63b3ed", fontWeight: 600 }}>{r.scenario}</span>
            </td>
            {cols.map((c) => (
              <td key={c.key} style={{ ...tdStyle, color: cellColor(c.key, r[c.key] as number) }}>
                {c.fmt(r[c.key] as number)}
              </td>
            ))}
            <td style={tdStyle}>{(r.finishedAt - r.startedAt).toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cellColor(key: keyof ScenarioResult, value: number): string {
  if (key === "totalLongTaskMs" && value > 0) return "#fc8181";
  if (key === "p95RenderMs" && value > 16) return "#f6ad55";
  return "#e2e8f0";
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  padding: "6px 12px",
  textAlign: "right",
  color: "#718096",
  borderBottom: "1px solid #2d3748",
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 12px",
  textAlign: "right",
};

type BtnVariant = "primary" | "secondary" | "ghost" | "disabled";

function btnStyle(variant: BtnVariant): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: 4,
    border: "none",
    cursor: variant === "disabled" ? "not-allowed" : "pointer",
    fontSize: 12,
    fontFamily: "monospace",
    fontWeight: 600,
  };
  switch (variant) {
    case "primary":
      return { ...base, background: "#3182ce", color: "#fff" };
    case "secondary":
      return { ...base, background: "#2d3748", color: "#63b3ed" };
    case "ghost":
      return { ...base, background: "transparent", color: "#718096" };
    case "disabled":
      return { ...base, background: "#1a202c", color: "#4a5568" };
  }
}
