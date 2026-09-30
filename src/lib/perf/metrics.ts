/**
 * Core perf metrics types and aggregation helpers.
 *
 * A "run" is one deterministic tick sequence executed by the harness.
 * A "sample" is one React Profiler commit callback invocation.
 */

export interface ProfileSample {
  /** Component id passed to <Profiler id="…"> */
  id: string;
  /** React Profiler phase: "mount" or "update" */
  phase: "mount" | "update";
  /** Time spent rendering this subtree (ms) */
  actualDuration: number;
  /** Estimated base duration if nothing changed (ms) */
  baseDuration: number;
  /** Timestamp when the commit was committed */
  commitTime: number;
}

export interface LongTask {
  startTime: number;
  duration: number;
}

export interface ScenarioResult {
  scenario: string;
  /** Total number of Profiler commit callbacks during the run */
  commitCount: number;
  /** Sum of actualDuration across all commits (ms) */
  totalRenderMs: number;
  /** p50 actualDuration per commit (ms) */
  p50RenderMs: number;
  /** p95 actualDuration per commit (ms) */
  p95RenderMs: number;
  /** Long tasks (>50 ms) captured by PerformanceObserver */
  longTasks: LongTask[];
  /** Total duration of long tasks (ms) */
  totalLongTaskMs: number;
  /** Timestamp when the harness started this scenario (epoch ms) */
  startedAt: number;
  /** Timestamp when the harness finished this scenario (epoch ms) */
  finishedAt: number;
  /** Raw samples (omitted from JSON export to keep file small) */
  samples?: ProfileSample[];
}

export interface PerfReport {
  version: 1;
  recordedAt: string;
  /** Git SHA or "local" */
  revision: string;
  results: ScenarioResult[];
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

export function aggregateSamples(
  scenario: string,
  samples: ProfileSample[],
  longTasks: LongTask[],
  startedAt: number,
  finishedAt: number,
): ScenarioResult {
  const durations = samples
    .map((s) => s.actualDuration)
    .sort((a, b) => a - b);

  return {
    scenario,
    commitCount: samples.length,
    totalRenderMs: durations.reduce((s, v) => s + v, 0),
    p50RenderMs: percentile(durations, 50),
    p95RenderMs: percentile(durations, 95),
    longTasks,
    totalLongTaskMs: longTasks.reduce((s, t) => t.duration + s, 0),
    startedAt,
    finishedAt,
  };
}

export function buildReport(
  results: ScenarioResult[],
  revision = "local",
): PerfReport {
  return {
    version: 1,
    recordedAt: new Date().toISOString(),
    revision,
    results,
  };
}

/**
 * Compare a new result against a baseline, returning a list of regressions
 * where `(newValue - baseValue) / baseValue > threshold` (default 0.20 = 20%).
 */
export interface Regression {
  scenario: string;
  metric: string;
  baseline: number;
  current: number;
  /** Fractional increase, e.g. 0.35 = 35% worse */
  delta: number;
}

export function detectRegressions(
  baseline: PerfReport,
  current: PerfReport,
  threshold = 0.2,
): Regression[] {
  const regressions: Regression[] = [];
  const baseMap = new Map(baseline.results.map((r) => [r.scenario, r]));

  for (const cur of current.results) {
    const base = baseMap.get(cur.scenario);
    if (!base) continue;

    const check = (metric: keyof ScenarioResult) => {
      const b = base[metric] as number;
      const c = cur[metric] as number;
      if (b === 0) return;
      const delta = (c - b) / b;
      if (delta > threshold) {
        regressions.push({ scenario: cur.scenario, metric: String(metric), baseline: b, current: c, delta });
      }
    };

    check("commitCount");
    check("totalRenderMs");
    check("p95RenderMs");
    check("totalLongTaskMs");
  }

  return regressions;
}
