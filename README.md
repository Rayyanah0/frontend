# Zenith Frontend

Next.js 14 (App Router) options trading terminal for Zenith, a decentralized
options protocol on Stellar Soroban. Options chain, portfolio, trade history,
multi-leg strategy builder, and a vol surface — all in a dense,
Bloomberg-style dark UI.

## Status: wired up to the real backend

Account, positions, trade history, watchlist, and alerts all come from the
real backend API now (`src/lib/api/*.ts`), not `localStorage` — the local
zustand stores for those were removed once the backend versions replaced
them; `src/lib/store/` now holds only `wallet.ts`. A shared WebSocket
connection (`src/lib/context/SpotFeedContext.tsx`) feeds live spot/vol
ticks into the options chain and portfolio pages. Wallet sign-in is a real
end-to-end flow: connect via Freighter → request a nonce → sign it with
`freighterApi.signBlob` → verify with the backend → store the returned
bearer token and send it as `Authorization: Bearer <token>` on every authed
request (`src/lib/store/wallet.ts`). That said, the signature encoding
hasn't been manually confirmed against a live Freighter extension (no
extension available in this environment) — the flow is logically complete,
not hardware-tested.

Client-side Black-Scholes pricing (`src/lib/pricing.ts`) hasn't gone away —
it's now a fallback and preview layer rather than the primary source: the
options chain falls back to it if the backend fetch fails, per-row live
Greeks in the positions table are computed locally rather than
round-tripped, and multi-leg strategy *preview* pricing (before execution)
is local-only. The backend's `/api/v1/portfolio/payoff` endpoint has a
typed client (`src/lib/api/payoff.ts`) but nothing in the app calls it yet —
the payoff diagram still uses local math (`src/lib/payoff.ts`).

## Getting started

```bash
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL, defaults to http://localhost:8081
npm run dev
# http://localhost:3000
```

Run the [backend](https://github.com/Zenith-options/backend) alongside it
(`cargo run`, default port 8081) for account/positions/history/watchlist/
alerts/live spot to actually load — without it, only the home page's local
preview chain and the options chain's client-side BS fallback will render.

```bash
npm run build   # production build
npm run lint     # next lint
npm test         # vitest unit tests
```

## Pages

| Route | What's there |
|---|---|
| `/` | Marketing/landing page, live preview chain, watchlist |
| `/options` | The terminal: chain, positions, strategy builder, vol surface, customizable workspace (≥1024px) |
| `/portfolio` | Open positions marked-to-market, partial/batch/strategy close, roll, CSV export, portfolio risk, P&L attribution |
| `/history` | Full trade ledger (opens + closes) with realized P&L stats, performance analytics (equity curve, drawdown, breakdowns) |
| `/calendar` | Expiry calendar (month/list), settlement center, `.ics` download |

The `/options` page is tabbed below 1024px (and via the Tabs toggle):

- **Chain** — configurable columns, strike windows (±N / delta), ATM jump, optional dual-expiry compare. Click an ask to buy, a bid to write.
- **Positions** — quick view of open positions for the selected symbol;
  "Manage →" links to `/portfolio` for the actual close/roll actions.
- **Strategies** — templated multi-leg trades (straddle, bull call spread,
  bear put spread, iron condor) with a combined payoff diagram, executed
  atomically.
- **Surface** — an IV heatmap across strikes and expiries, with a simple
  term-structure model (skew dampens for longer-dated options).

On wide viewports, **Workspace** mode (react-grid-layout) lets you drag/resize
panels (chain, ticket, payoff, spot, smile, positions, alerts, surface,
strategies), apply Trader / Vol / Writer presets, and save/export/import
layouts per wallet.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘/Ctrl+K` or `/` | Command palette (fuzzy search; recent commands) |
| `?` | Shortcut help overlay |
| `1`–`4` | Chain / Positions / Strategies / Surface tabs |
| `[` / `]` | Previous / next expiry |
| `B` / `S` | Open buy / write ticket on focused strike (confirm still required) |
| `A` | Jump to ATM |
| `⇧P` / `⇧H` / `⇧O` | Portfolio / History / Options |

Hotkeys are disabled inside text inputs. Bindings persist in
`localStorage` (`zenith.hotkeys.v1`). Palette commands like "BTC 30D",
"buy call", "go portfolio", "toggle surface" are registered via
`src/components/command/registry.ts`.

## Architecture

Options module map (`src/app/options/_components/`): `MarketHeader` (symbol
tabs, spot, expiries), `MarketSidebar`, `ViewTabs`, `ChainTable` +
`useOptionChain` (fetch, 4s polling, Black-Scholes fallback), `TradeTicket` +
`useTradeTicket` (validation, collateral, funds), `PositionsTab`,
`StrategiesTab` + `useStrategyPreview`, `SurfaceTab`, `PortfolioBar`,
`StatusBar`. `page.tsx` only composes them.

```
src/
├── app/                  # Next.js App Router pages
│   ├── layout.tsx        # SpotFeed + BackendData + CommandLayer
│   ├── page.tsx          # Home
│   ├── options/          # Chain / Positions / Strategies / Surface / Workspace
│   ├── portfolio/        # Open positions, roll, close, attribution, partial/batch/strategy close
│   ├── history/          # Trade ledger + performance analytics
│   └── calendar/         # Expiry calendar + settlement center
├── components/           # UI components (charts, dialogs, header, etc.)
│   └── command/          # Command palette, hotkeys, help overlay
├── features/
│   ├── chain/            # AdvancedChain + column/strike-window utils
│   └── workspace/        # Grid layouts, presets, persistence
└── lib/
    ├── api/              # Typed backend client (+ close feature detection)
    ├── close/            # Partial P&L math + batch executor
    ├── hooks/            # useBackend* including closeBatch / closeStrategyGroup
    ├── context/
    ├── store/            # zustand + persist — now just wallet.ts (connect,
    │                      # sign-in-with-backend, bearer token)
    ├── pricing.ts        # Black-Scholes, vol smile — fallback/preview layer, see above
    ├── attribution.ts    # Taylor Greek P&L attribution (local baselines)
    ├── analytics.ts      # Equity curve, drawdown, trade statistics
    ├── expiry.ts         # Expiry derivation, grouping, .ics, settlement helpers
    ├── alertRules.ts     # Client-side alert rule evaluator (hysteresis/cooldown)
    ├── collateral.ts     # Collateral requirements (100% calls, 110% puts)
    ├── payoff.ts          # Multi-leg combined payoff math (local; backend equivalent unused)
    ├── risk.ts             # Whole-portfolio risk + mark-to-model scenarioGrid
    ├── heatScale.ts       # Colorblind-safe chain heat scales + contrast checks
    ├── candles.ts         # Tick→OHLC aggregation, SMA/EMA, realized vol
    ├── volSurface.ts      # Term-structure IV surface grid + WebGL mesh
    ├── strategies.ts      # Multi-leg strategy templates
    ├── csv.ts / notify.ts # CSV export, browser + in-app notifications
    ├── useHydrated.ts     # SSR-hydration-safety hook (see below) — still relevant for wallet.ts
    ├── useCandleHistory.ts # Candle history (API or limited WS seed)
    └── usePriceHistory.ts # Legacy in-memory spot sparkline buffer
```

See also [docs/VISUALIZATIONS.md](docs/VISUALIZATIONS.md) for the chain heat map,
3D surface, candlestick chart, and scenario analysis features (#40–#43).

### A note on hydration safety

`wallet.ts` is the one remaining persisted store, using `skipHydration: true`
plus `StoreHydrator` (mounted once in the root layout) to pull the real
`localStorage` token in after mount instead of at module-eval time. That
alone isn't sufficient for anything that reads the wallet's bearer token to
fetch backend data: passing a token before this component's own mount
effect has fired risks fetching (and rendering) data the server-rendered
HTML didn't have. `BackendDataProvider` (`src/lib/context/BackendDataContext.tsx`)
gates on `useHydrated()` and only passes the real token down to
`useBackendAccount`/`useBackendPositions`/etc. once hydrated — everything
else in `src/app/options/page.tsx` and `src/app/history/page.tsx` that
reads wallet-gated state follows the same pattern. Workspace layouts also
render the Trader preset on SSR and hydrate from localStorage after mount.

## Close API contract (frontend)

Until the backend ships support, the client probes `GET /api/v1/features`
and falls back:

- `POST /api/v1/positions/{id}/close` with optional `{ contracts }` for partial close
- `POST /api/v1/strategies/{id}/close` for atomic strategy unwind
- Sequential per-leg closes with progress + stop/continue when unsupported
  (non-atomic leg risk is warned in the confirm dialog)

```bash
npm test          # node:test unit suite (attribution, analytics, expiry, alertRules)
```

## Known gaps

- Unit tests cover heat scales, candles, vol-surface mesh, and scenario grid
  (`npm test`). No Playwright e2e suite yet.
- No RTL / component test suite yet (pure lib modules are covered).
- PWA: hand-written `public/sw.js` (no Serwist/Workbox dependency), production-only registration, SVG icons only (no PNG set), no Playwright offline tests and no Lighthouse run yet. Only last-known public spot prices are snapshotted (IndexedDB, wiped on disconnect); positions/account are not cached.
- Playwright e2e keyboard/drag flows are not in CI yet; unit coverage is via vitest.
- No on-chain/Soroban integration — the backend is a paper-trading API, not
  a wallet transaction signer against the contracts.
- Wallet sign-in (`signBlob` → verify → bearer token) hasn't been manually
  confirmed against a live Freighter extension — no extension available in
  this environment. The flow is logically complete, not hardware-tested.
- The home page's preview chain still runs its own local random-walk spot
  simulation rather than the shared WebSocket feed — only its watchlist is
  backend-real.
- The backend's `/api/v1/portfolio/payoff` endpoint has a typed client
  (`src/lib/api/payoff.ts`) but nothing calls it — the payoff diagram still
  computes locally (`src/lib/payoff.ts`). Multi-leg strategy *preview*
  pricing (before execution) is also local-only, not backend-priced.
- `src/app/options/page.tsx` is now a composition shell; feature modules live
  in `src/app/options/_components/` (see Options module map above).
- The home page's preview chain still runs its own local random-walk spot
  simulation rather than the shared WebSocket feed — only its watchlist is
  backend-real.
- Accessibility is minimal — several controls (star toggle, alert form,
  contracts stepper) have no `aria-label`.

## License

MIT © Zenith Protocol Contributors

## API contracts

`src/lib/api/schemas.ts` holds a Zod schema per backend response; types in
`types.ts` are `z.infer`-derived. `request()` validates each response and throws
a `ContractError` (with per-field paths) on drift: shown in a dev overlay, sent
to `NEXT_PUBLIC_MONITOR_URL` in production. Extra backend fields are stripped;
numeric strings are coerced. `npm run api:check` validates the fixtures in
`contracts/fixtures/` (named after schema exports) and flags key drift.
