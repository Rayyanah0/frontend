import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the performance harness tests.
 *
 * Separate from any future general e2e config so CI can run perf tests
 * in isolation on the `--project=perf-chromium` target.
 *
 * Chrome flags:
 *   --enable-blink-features=PerformanceLongTaskTiming  — expose longtask entries
 *   --no-sandbox                                        — required in Docker/CI
 *   --disable-gpu                                       — headless CI stability
 */
export default defineConfig({
  testDir: "./e2e/perf",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  /* Run tests sequentially in CI to avoid noise from parallel processes */
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "e2e/perf/results/pw-report.json" }],
  ],
  use: {
    baseURL: process.env.PERF_BASE_URL ?? "http://localhost:3000",
    trace: "on",
    video: "off",
  },
  projects: [
    {
      name: "perf-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--enable-blink-features=PerformanceLongTaskTiming",
            "--no-sandbox",
            "--disable-gpu",
          ],
        },
      },
    },
  ],
});
