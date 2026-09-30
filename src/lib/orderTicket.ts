// Professional order-ticket state machine (#34).
// States: idle → quoting → quoted → confirming → submitting → filled | failed
// Quote lifetime defaults to 15s; slippage is checked client-side against
// the last quoted premium. Backend contract for enforcement is documented
// in ORDER_TICKET_BACKEND.md.

export const QUOTE_TTL_MS = 15_000;
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.50%

export type TicketStatus =
  | "idle"
  | "quoting"
  | "quoted"
  | "confirming"
  | "submitting"
  | "filled"
  | "failed";

export interface TicketQuote {
  premium: number;
  quotedAt: number;
  expiresAt: number;
  side: "call" | "put";
  mode: "buy" | "write";
  strike: number;
  expiryDays: number;
  underlying: string;
}

export interface TicketState {
  status: TicketStatus;
  quote: TicketQuote | null;
  quantity: number;
  maxSlippageBps: number;
  limitPrice: number | null;
  error: string | null;
  fillPremium: number | null;
}

export type TicketAction =
  | { type: "startQuote"; quote: Omit<TicketQuote, "quotedAt" | "expiresAt">; ttlMs?: number }
  | { type: "quoteReady"; premium: number }
  | { type: "refreshQuote"; premium: number; ttlMs?: number }
  | { type: "expireQuote" }
  | { type: "setQuantity"; quantity: number }
  | { type: "setSlippageBps"; bps: number }
  | { type: "setLimitPrice"; price: number | null }
  | { type: "beginConfirm" }
  | { type: "cancelConfirm" }
  | { type: "submit" }
  | { type: "filled"; fillPremium: number }
  | { type: "failed"; error: string }
  | { type: "reset" };

export function initialTicketState(): TicketState {
  return {
    status: "idle",
    quote: null,
    quantity: 1,
    maxSlippageBps: DEFAULT_SLIPPAGE_BPS,
    limitPrice: null,
    error: null,
    fillPremium: null,
  };
}

export function ticketReducer(state: TicketState, action: TicketAction): TicketState {
  switch (action.type) {
    case "startQuote": {
      const now = Date.now();
      const ttl = action.ttlMs ?? QUOTE_TTL_MS;
      return {
        ...state,
        status: "quoting",
        error: null,
        fillPremium: null,
        quote: {
          ...action.quote,
          premium: action.quote.premium,
          quotedAt: now,
          expiresAt: now + ttl,
        },
      };
    }
    case "quoteReady":
      if (!state.quote) return state;
      return {
        ...state,
        status: "quoted",
        quote: { ...state.quote, premium: action.premium },
      };
    case "refreshQuote": {
      if (!state.quote) return state;
      const now = Date.now();
      const ttl = action.ttlMs ?? QUOTE_TTL_MS;
      return {
        ...state,
        status: "quoted",
        error: null,
        quote: {
          ...state.quote,
          premium: action.premium,
          quotedAt: now,
          expiresAt: now + ttl,
        },
      };
    }
    case "expireQuote":
      if (state.status !== "quoted" && state.status !== "confirming") return state;
      return { ...state, status: "quoting", error: "Quote expired — refresh to continue" };
    case "setQuantity":
      return { ...state, quantity: Math.max(0.01, action.quantity) };
    case "setSlippageBps":
      return { ...state, maxSlippageBps: Math.max(0, action.bps) };
    case "setLimitPrice":
      return { ...state, limitPrice: action.price };
    case "beginConfirm":
      if (state.status !== "quoted" || !state.quote) return state;
      if (Date.now() >= state.quote.expiresAt) {
        return { ...state, status: "quoting", error: "Quote expired — refresh to continue" };
      }
      return { ...state, status: "confirming", error: null };
    case "cancelConfirm":
      if (state.status !== "confirming") return state;
      return { ...state, status: "quoted" };
    case "submit":
      if (state.status !== "confirming" && state.status !== "quoted") return state;
      return { ...state, status: "submitting", error: null };
    case "filled":
      return { ...state, status: "filled", fillPremium: action.fillPremium, error: null };
    case "failed":
      return { ...state, status: "failed", error: action.error };
    case "reset":
      return initialTicketState();
    default:
      return state;
  }
}

/** Returns the relative slippage in bps of fill vs quote, or null if no quote. */
export function slippageBps(quoted: number, fill: number): number {
  if (quoted <= 0) return fill > 0 ? Infinity : 0;
  return (Math.abs(fill - quoted) / quoted) * 10_000;
}

/**
 * Client-side price protection. Buyers reject fills ABOVE tolerance;
 * writers reject fills BELOW tolerance (worse premium received).
 *
 * Backend contract (to be enforced server-side):
 *   POST /api/v1/positions/open
 *   body may include { max_slippage_bps?: number, limit_price?: number, quote_id?: string }
 *   Server MUST reject with 409 { code: "SLIPPAGE_EXCEEDED", quoted, fill }
 *   when the fill premium breaches the client's protection.
 */
export function checkPriceProtection(
  mode: "buy" | "write",
  quotedPremium: number,
  fillPremium: number,
  maxSlippageBps: number,
  limitPrice: number | null
): { ok: true } | { ok: false; reason: string; slippageBps: number } {
  const slip = slippageBps(quotedPremium, fillPremium);

  if (limitPrice != null) {
    if (mode === "buy" && fillPremium > limitPrice + 1e-12) {
      return { ok: false, reason: `Fill $${fillPremium.toFixed(6)} exceeds limit $${limitPrice.toFixed(6)}`, slippageBps: slip };
    }
    if (mode === "write" && fillPremium < limitPrice - 1e-12) {
      return { ok: false, reason: `Fill $${fillPremium.toFixed(6)} below limit $${limitPrice.toFixed(6)}`, slippageBps: slip };
    }
  }

  const worse =
    mode === "buy" ? fillPremium > quotedPremium : fillPremium < quotedPremium;
  if (worse && slip > maxSlippageBps) {
    return {
      ok: false,
      reason: `Slippage ${slip.toFixed(0)} bps exceeds max ${maxSlippageBps} bps (quoted $${quotedPremium.toFixed(6)} → fill $${fillPremium.toFixed(6)})`,
      slippageBps: slip,
    };
  }
  return { ok: true };
}

export function quoteRemainingMs(quote: TicketQuote | null, now = Date.now()): number {
  if (!quote) return 0;
  return Math.max(0, quote.expiresAt - now);
}

export function isQuoteLive(quote: TicketQuote | null, now = Date.now()): boolean {
  return !!quote && now < quote.expiresAt;
}
