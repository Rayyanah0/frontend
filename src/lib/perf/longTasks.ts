"use client";

/**
 * Long-task collector using PerformanceObserver.
 *
 * Starts collecting when `start()` is called and stops + returns the
 * accumulated tasks when `stop()` is called.  Gracefully degrades in
 * environments where the longtask API is unavailable (e.g., Firefox,
 * Safari, non-Chrome Playwright).
 */

import type { LongTask } from "./metrics";

export interface LongTaskCollector {
  stop: () => LongTask[];
}

const LONG_TASK_THRESHOLD_MS = 50;

export function startLongTaskCollection(): LongTaskCollector {
  const tasks: LongTask[] = [];

  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    // Environment doesn't support longtask — return empty collector.
    return { stop: () => [] };
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration >= LONG_TASK_THRESHOLD_MS) {
        tasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }
  });

  try {
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // Observation failed (e.g., permissions policy) — return empty collector.
    return { stop: () => [] };
  }

  return {
    stop: () => {
      observer.disconnect();
      return [...tasks];
    },
  };
}

/**
 * Export a PerfReport (or any JSON-serialisable value) as a downloadable
 * JSON file. Only works in browser contexts.
 */
export function exportJson(data: unknown, filename = "perf-report.json"): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
