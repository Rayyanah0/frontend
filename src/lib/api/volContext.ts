/**
 * Typed data adapter interface for the Volatility Context panel.
 *
 * The backend contract (historical IV + OHLC prices) is not yet available.
 * When NEXT_PUBLIC_VOL_CONTEXT=mock (or the env var is absent), the mock
 * implementation below is used. Swap in the real implementation by setting
 * NEXT_PUBLIC_VOL_CONTEXT=live and wiring up `fetchVolContextLive`.
 *
 * Backend contract (for when the real API lands):
 *
 *   GET /api/v1/market/{underlying}/vol-history?days=365
 *   → { dates: string[], iv: number[], closes: number[] }
 *
 *   GET /api/v1/market/{underlying}/iv-atm
 *   → { iv: number }
 */

export interface VolContextData {
  /** Underlying symbol, e.g. "XLM". */
  underlying: string;
  /** Current ATM implied volatility (0–1). */
  currentIv: number;
  /** 252 daily ATM IV observations, oldest first. */
  ivHistory: number[];
  /** Daily close prices for the past ~504 days, oldest first. */
  closes: number[];
}

// ---------------------------------------------------------------------------
// Mock implementation – deterministic, seeded by symbol
// ---------------------------------------------------------------------------

/** Very simple PRNG (xorshift32) seeded with a number. */
function xr(seed: number): () => number {
  let s = (seed | 0) || 123456789;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

const BASE_IVS: Record<string, number> = {
  XLM: 0.82,
  BTC: 0.65,
  ETH: 0.72,
  SOL: 0.91,
};

const BASE_PRICES: Record<string, number> = {
  XLM: 0.1182,
  BTC: 67420.5,
  ETH: 3512.8,
  SOL: 182.45,
};

function generateMockVolContext(underlying: string, currentIvLive?: number): VolContextData {
  const seed = underlying.split("").reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7);
  const rng = xr(seed);
  const baseIv = BASE_IVS[underlying] ?? 0.65;
  const basePrice = BASE_PRICES[underlying] ?? 100;

  // 504 days (~2 years) of mock close prices via geometric Brownian motion
  const closes: number[] = [basePrice];
  const dailyVol = baseIv / Math.sqrt(252);
  for (let i = 1; i < 504; i++) {
    const shock = (rng() - 0.5) * 2 * dailyVol;
    closes.push(Math.max(closes[i - 1] * (1 + shock), basePrice * 0.05));
  }

  // 252 days of ATM IV history – mean-reverting around baseIv
  const ivHistory: number[] = [baseIv];
  for (let i = 1; i < 252; i++) {
    const prev = ivHistory[i - 1];
    const mr = 0.02 * (baseIv - prev); // mean reversion
    const noise = (rng() - 0.5) * 0.04;
    ivHistory.push(Math.max(0.05, prev + mr + noise));
  }

  // Ensure the "current" IV matches the live feed if provided, otherwise
  // use a slightly shifted value so IVR/IVP are non-trivial to demo.
  const currentIv = currentIvLive ?? baseIv * (0.9 + rng() * 0.2);

  return { underlying, currentIv, ivHistory, closes };
}

// ---------------------------------------------------------------------------
// Live stub (not yet implemented – placeholder for wiring up real API)
// ---------------------------------------------------------------------------

async function fetchVolContextLive(_underlying: string, _currentIv?: number): Promise<VolContextData> {
  // TODO: replace with real API calls when the backend endpoint is available.
  // Example:
  //   const [hist, atm] = await Promise.all([
  //     apiGet<{dates:string[];iv:number[];closes:number[]}>(`/api/v1/market/${underlying}/vol-history?days=504`),
  //     apiGet<{iv:number}>(`/api/v1/market/${underlying}/iv-atm`),
  //   ]);
  //   return { underlying, currentIv: atm.iv, ivHistory: hist.iv, closes: hist.closes };
  throw new Error("Live vol context API not yet implemented");
}

// ---------------------------------------------------------------------------
// Public adapter — switches on feature flag
// ---------------------------------------------------------------------------

/**
 * Fetch volatility context data for the given underlying.
 *
 * Feature-flagged: set NEXT_PUBLIC_VOL_CONTEXT=live to switch from mock to
 * the real backend (once the endpoint exists). Defaults to "mock".
 *
 * @param underlying   Symbol such as "XLM".
 * @param currentIv    Current ATM IV from the live spot feed (optional – used
 *                     to keep the mock's "current" figure consistent with the
 *                     chain page values).
 */
export async function fetchVolContext(
  underlying: string,
  currentIv?: number
): Promise<VolContextData> {
  const flag = process.env.NEXT_PUBLIC_VOL_CONTEXT ?? "mock";
  if (flag === "live") {
    return fetchVolContextLive(underlying, currentIv);
  }
  // Synchronous mock wrapped in a promise to match the async interface.
  return Promise.resolve(generateMockVolContext(underlying, currentIv));
}
