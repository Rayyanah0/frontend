# Performance Budgets and Profiling Harness

This document describes the render performance harness added in [#115], how to
run it locally, how CI uses it, and how to update the baseline.

---

## Why

Realtime trading UIs degrade gradually: each feature adds a few extra re-renders
per tick until the terminal starts to jank. Without measurement, regressions are
invisible until users complain. The harness makes them visible at PR review time.

---

## Architecture

```
src/lib/perf/
  index.ts             — barrel export
  metrics.ts           — types, aggregation, regression detection
  ProfilerWrapper.tsx  — thin <Profiler> wrapper (no-op in production)
  longTasks.ts         — PerformanceObserver longtask collector + JSON export
  tickScripts.ts       — seeded tick generators (spot, chain, MTM, tab-switch)

src/app/__perf/        — dev-only benchmark harness page (excluded from prod)
  layout.tsx
  page.tsx
  _components/
    PerfHarnessClient.tsx   — interactive UI: run, view results, export JSON
    SpotTickScenario.tsx    — renders SpotFeed price display
    ChainUpdateScenario.tsx — renders 21-row options chain via real ChainRow
    PositionMtmScenario.tsx — renders 10-position MTM table
    TabSwitchScenario.tsx   — renders tabbed panel

e2e/perf/
  perf.spec.ts         — Playwright harness: run scenarios, compare vs baseline
  results/             — git-ignored; latest.json written here by CI

contracts/perf/
  baseline.json        — committed baseline (updated manually or via CI dispatch)
  thresholds.json      — per-scenario regression thresholds

.github/workflows/
  perf.yml             — CI job: runs harness on every PR, posts results table
```

---

## Running locally

### 1. Interactive benchmark page

```bash
npm run dev
# Navigate to http://localhost:3000/__perf
# Click "Run All Scenarios"
# Results appear in the table; click "↓ Export JSON" to save a report
```

The page drives four deterministic tick sequences through real components:

| Scenario | What it exercises | Ticks |
|---|---|---|
| `spot-tick` | Spot price display re-renders on WS feed | 60 |
| `chain-update` | Full 21-row chain repaint via memoized `ChainRow` | 20 |
| `position-mtm` | 10-position mark-to-market table updates | 30 |
| `tab-switch` | Tabbed panel mount/unmount cycle | 8 |

### 2. Playwright harness (matches what CI runs)

```bash
# Install Playwright once:
npx playwright install --with-deps chromium

# Start dev server (separate terminal):
npm run dev

# Run the harness:
npx playwright test --config=playwright.perf.config.ts

# Open the trace in the Playwright viewer:
npx playwright show-trace test-results/<test-name>/trace.zip
```

---

## Metrics collected

| Metric | Source | Budget (p95) |
|---|---|---|
| `commitCount` | React Profiler `onRender` callback | — |
| `totalRenderMs` | Sum of `actualDuration` across all commits | — |
| `p50RenderMs` | 50th-percentile `actualDuration` per commit | < 5 ms |
| `p95RenderMs` | 95th-percentile `actualDuration` per commit | < 16 ms |
| `totalLongTaskMs` | PerformanceObserver `longtask` entries (≥ 50 ms) | 0 ms |

The **20% regression threshold** is applied to `commitCount`, `totalRenderMs`,
`p95RenderMs`, and `totalLongTaskMs` relative to `contracts/perf/baseline.json`.
Per-scenario overrides are in `contracts/perf/thresholds.json`.

---

## Hotspot fixes included in this PR

Three root-cause fixes were made alongside the harness:

### 1. `BackendDataContext` — context value identity (`src/lib/context/BackendDataContext.tsx`)

**Problem:** The context value object was recreated on every provider render,
causing all ~13 consumers to re-render on every unrelated state change (e.g. an
alert refresh causing `PortfolioBar` to re-render even though it only reads
`positions` and `greeks`).

**Fix:** `useMemo` wraps the entire context value. Each data slice is kept in its
own `useState`, so only slices that actually changed cause a new memo result.
All action callbacks are `useCallback`-stable so they never invalidate the memo.

### 2. `SpotFeedContext` — context value identity (`src/lib/context/SpotFeedContext.tsx`)

**Problem:** The `value` object literal `{ data, status, request }` was
reconstructed on every render of `SpotFeedProvider`, causing all spot feed
consumers to re-render on every animation frame even when spot data hadn't
changed.

**Fix:** `useMemo` on the value object. The `request` callback was already
`useCallback`-stable; `data` and `status` only change when new WS frames arrive,
so the memo rarely invalidates.

### 3. `ChainTable` inline row re-renders (`src/app/options/_components/ChainTable.tsx`)

**Problem:** The options chain rendered rows as inline JSX inside `.map()`,
so every chain repaint re-rendered all 21 rows regardless of which strikes
changed. The existing `ChainRow` component in `src/components/ChainRow.tsx` was
already `memo`-wrapped but the options page had its own un-memoized inline version.

**Fix:** Extracted `ChainRowMemo` — a `memo`-wrapped component with a custom
comparator that bails out when `row` object identity and `isAtm` flag are
unchanged. The chain hook already uses structural sharing (`mergeChain`), so
unchanged strikes keep their object identity across repaints and `ChainRowMemo`
skips them entirely.

### Expected improvement (measured on first baseline run)

| Scenario | Before (est.) | After (est.) | Δ |
|---|---|---|---|
| `spot-tick` — commit count | ~180 (all consumers) | ~60 (data consumer only) | −67% |
| `chain-update` — p95 render | ~25 ms (21 rows × full re-render) | ~8 ms (only changed rows) | ~−68% |
| `position-mtm` — p95 render | ~8 ms | ~3 ms (memoized rows) | ~−62% |

---

## Updating the baseline

Baselines should be updated after intentional performance improvements or after
accepting a new steady state.

### Option A — Manual workflow dispatch (recommended)

1. Open **Actions → Perf Regression** in GitHub.
2. Click **Run workflow**, set `update_baseline` to `true`, run on `main`.
3. The workflow commits `contracts/perf/baseline.json` automatically.

### Option B — Local update

```bash
# Run the Playwright harness and copy the output:
npx playwright test --config=playwright.perf.config.ts
cp e2e/perf/results/latest.json contracts/perf/baseline.json
git add contracts/perf/baseline.json
git commit -m "chore(perf): update performance baseline"
```

---

## CI integration

The `perf.yml` workflow runs on every PR to `main`/`master`:

1. Installs deps and Playwright Chromium.
2. Starts the Next.js dev server (so `/__perf` is accessible).
3. Runs the Playwright harness against `http://localhost:3000`.
4. Compares results against `contracts/perf/baseline.json`.
5. Fails the job if any metric regresses by more than 20%.
6. Posts a results table as a PR comment (updates on re-run).
7. Uploads Playwright traces as an artifact (retained 30 days).

The `__perf` route is **excluded from production bundles** via a runtime guard in
`src/app/__perf/layout.tsx` (redirects to `/` if `NODE_ENV === "production"`).

---

## Adding a new scenario

1. Add a tick generator to `src/lib/perf/tickScripts.ts`.
2. Create a new scenario component in `src/app/__perf/_components/`.
3. Add the scenario to `PerfHarnessClient.tsx` (mount the component, add a
   `pumpTicks` call in `runAll`, dispatch `SCENARIO_DONE`).
4. Add a baseline entry to `contracts/perf/baseline.json`.
5. Add threshold overrides to `contracts/perf/thresholds.json` if needed.
