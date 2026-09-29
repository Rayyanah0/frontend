# Terminal visualizations (issues #40–#43)

## #40 Chain heat mapping

- Toggle **Heat → IV / |Δ| / Θ** above the chain. Scales are precomputed once per
  visible window via `buildChainHeatScales` (`src/lib/heatScale.ts`).
- Sequential ColorBrewer-style scale for IV and |Δ|; diverging for Θ.
- Volume / OI columns use inline mini-bars. When the API omits liquidity fields
  the cell shows **N/A** (mock `seededRandom` values removed from the chain).
- Contract additions on `OptionChainEntry`:
  - `call_volume`, `put_volume`
  - `call_open_interest`, `put_open_interest`
- Theme tokens: `--heat-seq-*`, `--heat-div-*`, `--heat-bar` in `globals.css`
  and `zn-heat-*` in `tailwind.config.ts`.
- Color is never the only channel — numeric text remains visible with ≥4.5:1
  contrast (see `paletteMeetsContrast` tests).

## #41 3D IV surface

- Surface tab lazy-loads `VolSurface3D` (compact raw WebGL + orbit drag) via
  `next/dynamic` — the WebGL bundle is not on the initial page load and stays
  well under the 150 kB gzipped budget (no three.js runtime dependency).
- Mesh built by `buildSurfaceMesh` from the existing `volSurface.ts` grid.
- Hover readout, click-to-open order ticket, smile/term slice charts, accessible
  data table, heatmap fallback when WebGL is unavailable.
- Respects `prefers-reduced-motion` (no auto-rotate). GPU resources disposed on
  unmount; context-loss flips to the table fallback.

## #42 Candlestick spot chart

- `SpotPriceChart` is an SVG candlestick/line chart themed with zn-* tokens
  (zoom/pan, crosshair, SMA/EMA overlays). No mandatory chart-lib runtime dep.
- Timeframes 1m / 5m / 1h / 1D; realized vol (20) shown next to ATM IV;
  open-position strike lines; entry/exit markers supported via props.
- Live ticks aggregate into the current candle (`src/lib/candles.ts`).
- API contract: `GET /api/v1/candles?underlying=&interval=&limit=`
  → `{ underlying, interval, candles: [{ time, open, high, low, close, volume? }] }`
  (`time` = unix seconds UTC). Until the endpoint exists, history is seeded from
  the WS buffer and labeled **Limited history**.

## #43 Portfolio scenario analysis

- Default mode is mark-to-model (`scenarioGrid` in `src/lib/risk.ts`).
- Configurable spot / IV shock axes and days-forward; correlated vs independent.
- Heat-mapped matrix with worst-case highlight, click-to-drill, CSV export.
- Computation preferred in `src/lib/workers/quantWorker.ts` (main-thread fallback).
- Legacy expiry intrinsic stress retained as **Expiry stress** mode.
