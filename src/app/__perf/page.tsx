/**
 * Benchmark harness page — dev-only route at /__perf
 *
 * Drives four scripted tick scenarios through real components, collects
 * React Profiler commits and PerformanceObserver long-task data, and
 * renders results in a Bloomberg-style dashboard.
 */
import PerfHarnessClient from "./_components/PerfHarnessClient";

export default function PerfHarnessPage() {
  return <PerfHarnessClient />;
}
