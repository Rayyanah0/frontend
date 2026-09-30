/**
 * e2e/perf/perf.spec.ts — Playwright performance harness
 *
 * Navigates to the dev-only `/__perf` benchmark page, triggers all four
 * scenarios, waits for results, then compares them against the baseline
 * JSON using the 20% regression threshold from src/lib/perf/metrics.ts.
 *
 * Chrome tracing is enabled via Playwright's `trace: "on"` config so every
 * run produces a `.zip` trace file in `test-results/` that can be loaded in
 * `chrome://tracing` or the Playwright trace viewer.
 *
 * Usage:
 *   npx playwright test --config=playwright.perf.config.ts
 *   PERF_BASE_URL=http://staging.example.com npx playwright test --config=playwright.perf.config.ts
 */

import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PerfReport, ScenarioResult } from "../../src/lib/perf/metrics";
import { detectRegressions } from "../../src/lib/perf/metrics";

// Resolved path to the baseline checked into the repo.
const BASELINE_PATH = path.join(__dirname, "../../contracts/perf/baseline.json");
// Where to write the latest run's report (picked up by CI as an artifact).
const LATEST_REPORT_PATH = path.join(__dirname, "results/latest.json");
// Regression threshold: fail if any metric regresses by more than this fraction.
const REGRESSION_THRESHOLD = 0.2; // 20%

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadBaseline(): PerfReport | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as PerfReport;
  } catch {
    return null;
  }
}

function saveReport(report: PerfReport): void {
  const dir = path.dirname(LATEST_REPORT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LATEST_REPORT_PATH, JSON.stringify(report, null, 2));
}

// ─── Test ─────────────────────────────────────────────────────────────────────
test.describe("Performance harness", () => {
  test("all four scenarios run and produce results", async ({ page }) => {
    // Navigate to the harness page.
    await page.goto("/__perf");
    await page.waitForSelector('[data-testid="run-all-btn"]', { timeout: 10_000 });

    // Click "Run All Scenarios".
    await page.click('[data-testid="run-all-btn"]');

    // Wait for all four scenarios to complete (the results table appears).
    await page.waitForSelector('[data-testid="results-table"]', { timeout: 90_000 });

    // Read back the results from the DOM by exporting JSON via CDP eval.
    // The harness page exposes the current report on `window.__perfReport`
    // for programmatic access.
    const report = await page.evaluate<PerfReport | null>(() => {
      // @ts-expect-error — injected by PerfHarnessClient
      return (window as unknown as { __perfReport?: PerfReport }).__perfReport ?? null;
    });

    // ── Structural assertions ──────────────────────────────────────────────
    if (report) {
      expect(report.version).toBe(1);
      expect(report.results.length).toBe(4);

      const scenarios = report.results.map((r: ScenarioResult) => r.scenario);
      expect(scenarios).toContain("spot-tick");
      expect(scenarios).toContain("chain-update");
      expect(scenarios).toContain("position-mtm");
      expect(scenarios).toContain("tab-switch");

      for (const result of report.results) {
        expect(result.commitCount).toBeGreaterThan(0);
        expect(result.totalRenderMs).toBeGreaterThanOrEqual(0);
        expect(result.p95RenderMs).toBeGreaterThanOrEqual(0);
      }

      // Persist the report for the CI artifact upload step.
      saveReport(report);

      // ── Regression comparison ──────────────────────────────────────────
      const baseline = loadBaseline();
      if (baseline) {
        const regressions = detectRegressions(baseline, report, REGRESSION_THRESHOLD);
        if (regressions.length > 0) {
          const lines = regressions.map(
            (r) =>
              `  [${r.scenario}] ${r.metric}: baseline=${r.baseline.toFixed(2)} current=${r.current.toFixed(2)} (+${(r.delta * 100).toFixed(1)}%)`,
          );
          throw new Error(
            `Performance regression(s) detected (threshold=${REGRESSION_THRESHOLD * 100}%):\n${lines.join("\n")}`,
          );
        }
      } else {
        console.warn(
          `[perf] No baseline found at ${BASELINE_PATH}. Skipping regression check.`,
        );
      }
    } else {
      // Fallback: just verify the results table has four rows.
      const rows = page.locator('[data-testid="results-table"] tbody tr');
      await expect(rows).toHaveCount(4, { timeout: 5_000 });
    }
  });

  test("injected regression is detected", async ({ page }) => {
    // This test verifies the harness can *catch* a regression, not just pass.
    // We build a fake baseline with very low numbers and a "current" report
    // with numbers 30% worse — detectRegressions must flag them.
    const fakeBaseline: PerfReport = {
      version: 1,
      recordedAt: new Date().toISOString(),
      revision: "baseline",
      results: [
        {
          scenario: "spot-tick",
          commitCount: 60,
          totalRenderMs: 100,
          p50RenderMs: 1.5,
          p95RenderMs: 3.0,
          longTasks: [],
          totalLongTaskMs: 0,
          startedAt: 0,
          finishedAt: 1000,
        },
      ],
    };

    const fakeCurrent: PerfReport = {
      version: 1,
      recordedAt: new Date().toISOString(),
      revision: "regressed",
      results: [
        {
          scenario: "spot-tick",
          commitCount: 60,
          totalRenderMs: 135, // +35% over baseline
          p50RenderMs: 1.5,
          p95RenderMs: 4.0, // +33% over baseline
          longTasks: [],
          totalLongTaskMs: 0,
          startedAt: 0,
          finishedAt: 1000,
        },
      ],
    };

    const regressions = detectRegressions(fakeBaseline, fakeCurrent, REGRESSION_THRESHOLD);
    expect(regressions.length).toBeGreaterThan(0);
    expect(regressions.some((r) => r.scenario === "spot-tick")).toBe(true);
  });
});
