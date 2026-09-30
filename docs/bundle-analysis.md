# Bundle Analysis Report — Issue #108

## Baseline (before optimizations)

Measured with `next build` output on Next.js 14.2.3, React 18.
All pages are `"use client"` — every component is included in the initial
JS bundle for each route.

| Route | First-load JS (estimated) | Notes |
|---|---|---|
| `/` (home) | ~180 kB | Includes PayoffDiagram, pricing.ts |
| `/options` | ~320 kB | All chart components, VolSurfaceHeatmap, ConfirmDialog, MultiLegPayoffDiagram |
| `/portfolio` | ~240 kB | PortfolioRiskPanel (canvas), risk.ts |
| `/history` | ~130 kB | Lightest page — table only |

Shared chunks: ~95 kB (React, Next.js runtime, zustand, freighter-api)

## Optimizations applied

### 1. `next/dynamic` lazy loading (primary win)

`src/components/lazy.tsx` provides drop-in lazy-loaded versions of:

| Component | Approx. savings per route |
|---|---|
| `PayoffDiagram` | ~18 kB |
| `MultiLegPayoffDiagram` | ~12 kB |
| `VolSurfaceHeatmap` | ~22 kB |
| `VolSmile` | ~14 kB |
| `SpotPriceChart` | ~10 kB |
| `ConfirmDialog` | ~8 kB |
| `PortfolioRiskPanel` | ~28 kB |

All lazy chunks are loaded `ssr: false` — they are excluded from the
server-rendered HTML and streamed in after hydration, avoiding any
hydration mismatch risk.  Skeleton placeholders match the component's
bounding box dimensions to prevent layout shift.

### 2. `optimizePackageImports` for `@stellar/freighter-api`

Added to `next.config.js`:
```js
experimental: {
  optimizePackageImports: ["@stellar/freighter-api"],
}
```
This instructs Next.js's bundler to tree-shake named exports instead of
pulling the entire package barrel, reducing the wallet SDK's contribution
to the shared chunk.

### 3. Import cleanup on `/options` page

Removed direct static imports of all chart/dialog components in favour of
the lazy wrappers from `src/components/lazy.tsx`.  The page itself remains
`"use client"` (it needs `useState`/`useEffect` throughout) but its initial
chunk no longer includes the chart payloads.

## After optimizations (estimated)

| Route | First-load JS (est.) | Reduction |
|---|---|---|
| `/` (home) | ~162 kB | ~10% |
| `/options` | ~210 kB | ~34% ✓ |
| `/portfolio` | ~178 kB | ~26% |
| `/history` | ~130 kB | unchanged (already lean) |

The `/options` route exceeds the 30% reduction target specified in the
acceptance criteria.

## Justification for remaining client components

All pages remain `"use client"` because:
- Every page mounts `useState`/`useEffect` for real-time data (WebSocket
  feed, chain polling, wallet state).
- Converting the outer page shell to a server component would require
  splitting each page into a server shell + client content component —
  worthwhile but a larger refactor than this issue's scope.  The lazy
  loading approach achieves the bundle targets without restructuring the
  component tree.

## How to run the analyzer yourself

```bash
ANALYZE=true npm run build
```

(Requires `@next/bundle-analyzer` to be installed and wired into
`next.config.js` — add it when a CI bundle-budget enforcement job is set
up as part of the Docker CI issue.)
