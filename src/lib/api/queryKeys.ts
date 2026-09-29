// Query-key factory. Authed keys embed the token so disconnecting or
// switching wallets never surfaces the previous wallet's cached data.
export const queryKeys = {
  account: (token: string | null) => ["account", token] as const,
  positions: (token: string | null) => ["positions", token] as const,
  openPositions: (token: string | null) => ["positions", token, { status: "open" }] as const,
  greeks: (token: string | null) => ["greeks", token] as const,
  watchlist: (token: string | null) => ["watchlist", token] as const,
  alerts: (token: string | null) => ["alerts", token] as const,
  history: (token: string | null) => ["history", token] as const,
  chain: (sym: string, expiryDays: number) => ["chain", sym, expiryDays] as const,
  expiries: (sym: string) => ["expiries", sym] as const,
};
