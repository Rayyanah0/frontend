# Next.js 15 + React 19 Migration Guide

## Changes made

### Package versions

| Package | Before | After |
|---|---|---|
| `next` | 14.2.3 | 15.3.4 |
| `react` | 18.x | 19.1.0 |
| `react-dom` | 18.x | 19.1.0 |
| `@types/react` | ^18 | ^19 |
| `@types/react-dom` | ^18 | ^19 |
| `eslint` | ^8 | ^9 |
| `eslint-config-next` | 14.2.3 | 15.3.4 |
| `zustand` | ^4.5.2 | ^5.0.3 |

### ESLint configuration

ESLint 9 uses a flat config format (`eslint.config.mjs`) instead of
`.eslintrc.json`.  The old file has been removed and replaced with the flat
config equivalent.

### Next.js 15 breaking changes addressed

#### 1. Fetch caching defaults changed

In Next.js 14, `fetch()` defaulted to `force-cache`.  In Next.js 15,
it defaults to `no-store`.

**Impact on this app:** None.  All data fetching uses the client-side
`src/lib/api/client.ts` wrapper which runs in the browser.  No server
components fetch data.  Documented in `next.config.js` comments.

#### 2. `params` and `searchParams` are now async in server components

In Next.js 15, `params` and `searchParams` props on server page components
are Promises that must be `await`-ed.

**Impact on this app:** None.  All pages are `"use client"` components and
use `useSearchParams()` from `next/navigation` (client hook) rather than
the `searchParams` prop.  The `useSearchParams` call in
`src/app/options/page.tsx` is already correctly wrapped in `<Suspense>`
(see the `OptionsPage` / `OptionsPageContent` split).

#### 3. `<Link>` no longer passes `legacyBehavior` by default

**Impact:** None — the app uses `<Link href="...">` directly, not the
legacy `<a>` nesting pattern.

#### 4. Turbopack is now stable

`npm run dev` updated to `next dev --turbopack` for faster local iteration.

### React 19 changes addressed

#### 1. `ref` as a prop (no `forwardRef`)

React 19 allows passing `ref` directly as a prop.  No `forwardRef` is
used in this codebase, so no change needed.

#### 2. `use client` / `use server` directives

No changes needed — the app already marks all interactive components with
`"use client"`.

#### 3. `StoreHydrator` and `useHydrated` under React 19 StrictMode

React 19 StrictMode double-invokes effects in development, which means
`useWalletStore.persist.rehydrate()` in `StoreHydrator` is called twice
in dev.  This is safe — `rehydrate()` is idempotent.

`useHydrated` sets state in `useEffect`, which fires once per mount even
under StrictMode (not double-fired for state updates), so the `hydrated`
flag still flips correctly.

#### 4. zustand v5 compatibility

zustand v5 is compatible with React 19.  The `create` + `persist`
middleware API is unchanged.  The `useWalletStore.persist.rehydrate()`
call in `StoreHydrator` remains valid — zustand v5 keeps the same
`persist` sub-object shape.

### Dependency compatibility notes

- `@stellar/freighter-api ^2.0.0`: React 19 compatible (no React peer dep)
- `zustand ^5.0.3`: React 19 compatible (peer dep accepts React 18/19)

## QA checklist

Use this for the PR manual QA pass.

### All routes

- [ ] No hydration warnings in the browser console on first load
- [ ] No React StrictMode double-render warnings
- [ ] `useHydrated()` still prevents wallet-gated data from showing before
      the store rehydrates (check: reload with a persisted wallet token —
      positions should not flash before hydration)

### `/` (home)

- [ ] Landing page renders without errors
- [ ] Preview options chain loads and ticks live
- [ ] Watchlist section renders (may be empty without a wallet)
- [ ] `Trade Options` link navigates to `/options`

### `/options`

- [ ] Market tabs (XLM/BTC/ETH/SOL) switch correctly
- [ ] Chain table loads from the backend (or falls back to local BS)
- [ ] Clicking ask/bid opens the right-hand trade panel
- [ ] Strategies tab renders StrategyPicker and payoff diagram
- [ ] Surface tab renders the vol heatmap
- [ ] Positions tab shows live positions (requires wallet + backend)
- [ ] Trade confirm dialog opens and submits without errors

### `/portfolio`

- [ ] Positions table renders and marks to market
- [ ] Roll panel opens, previews correctly, and submits
- [ ] Close button works
- [ ] CSV export works

### `/history`

- [ ] Trade history table renders
- [ ] Stats bar shows correct totals
- [ ] CSV export works

### Wallet flow

- [ ] Wallet connect button works (or shows "not installed" gracefully)
- [ ] Reconnect on reload restores session without a sign prompt (if token
      still valid)
- [ ] Disconnect clears token and hides position data

## Out of scope

New React 19 features (Actions, `useOptimistic`, Server Actions) are
intentionally not adopted here — only the migration changes required to
stay compatible are included, per the issue scope.
