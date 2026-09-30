/**
 * MockRfqAdapter — Issue #65.
 *
 * Simulates market-maker quote streams for the RFQ workflow without a real
 * backend. Used when NEXT_PUBLIC_ENABLE_RFQ_MOCK=true (feature flag).
 *
 * Simulation:
 * - Quotes arrive over 5–20 seconds after the RFQ is created.
 * - 2–5 makers respond with slightly different prices around the model price.
 * - Each quote has a 30s expiry window.
 * - The "best" quote is cheapest for buy, most expensive for sell.
 */

import type {
  RfqAdapter,
  RfqRecord,
  RfqLeg,
  MakerQuote,
  CreateRfqParams,
  AcceptQuoteParams,
} from "./types";

const QUOTE_WINDOW_MS = 30_000;  // 30 s
const MAKER_NAMES = ["MM-Aquila", "MM-Cygnus", "MM-Lyra", "MM-Vega", "MM-Sirius"];

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function seededRand(seed: number, offset: number): number {
  const x = Math.sin(seed + offset) * 10000;
  return Math.abs(x - Math.floor(x));
}

/** Net model price of an RFQ structure (sum of BS premiums, buy + sell) */
function netModelPrice(legs: RfqLeg[], modelPrice: number): number {
  return modelPrice; // Passed in pre-computed from the caller
}

export class MockRfqAdapter implements RfqAdapter {
  private store = new Map<string, RfqRecord>();
  private subscribers = new Map<string, Set<(rfq: RfqRecord) => void>>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  async createRfq(params: CreateRfqParams): Promise<RfqRecord> {
    const now = Date.now();
    const id = uuid();
    const rfq: RfqRecord = {
      id,
      underlying: params.underlying,
      legs: params.legs,
      totalContracts: params.totalContracts,
      limitPrice: params.limitPrice,
      status: "requested",
      quotes: [],
      acceptedQuote: null,
      modelPrice: params.modelPrice,
      quoteWindowExpiresAt: now + QUOTE_WINDOW_MS,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, rfq);
    this._scheduleQuoteSimulation(rfq);
    return { ...rfq };
  }

  async acceptQuote(params: AcceptQuoteParams): Promise<RfqRecord> {
    const rfq = this.store.get(params.rfqId);
    if (!rfq) throw new Error(`RFQ ${params.rfqId} not found`);
    const quote = rfq.quotes.find(q => q.id === params.quoteId);
    if (!quote) throw new Error(`Quote ${params.quoteId} not found`);
    if (rfq.status !== "quoting") throw new Error(`RFQ is not in quoting state`);

    rfq.status = "accepted";
    rfq.acceptedQuote = quote;
    rfq.updatedAt = Date.now();
    this._emit(params.rfqId, rfq);
    return { ...rfq };
  }

  async cancelRfq(rfqId: string): Promise<RfqRecord> {
    const rfq = this.store.get(rfqId);
    if (!rfq) throw new Error(`RFQ ${rfqId} not found`);
    rfq.status = "cancelled";
    rfq.updatedAt = Date.now();
    this._emit(rfqId, rfq);
    return { ...rfq };
  }

  subscribeToQuotes(rfqId: string, onUpdate: (rfq: RfqRecord) => void): () => void {
    if (!this.subscribers.has(rfqId)) this.subscribers.set(rfqId, new Set());
    this.subscribers.get(rfqId)!.add(onUpdate);
    return () => {
      this.subscribers.get(rfqId)?.delete(onUpdate);
    };
  }

  async listRfqs(): Promise<RfqRecord[]> {
    return Array.from(this.store.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Cleans up all timers (e.g. on unmount) */
  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  // ── Internal simulation ───────────────────────────────────────────────────

  private _emit(rfqId: string, rfq: RfqRecord): void {
    this.subscribers.get(rfqId)?.forEach(cb => cb({ ...rfq, quotes: [...rfq.quotes] }));
  }

  private _scheduleQuoteSimulation(rfq: RfqRecord): void {
    const numMakers = 2 + Math.floor(seededRand(rfq.createdAt, 1) * 4); // 2–5
    const now = rfq.createdAt;

    // Transition to "quoting" immediately
    const t0 = this._setTimeout(() => {
      const r = this.store.get(rfq.id);
      if (!r || r.status !== "requested") return;
      r.status = "quoting";
      r.updatedAt = Date.now();
      this._emit(rfq.id, r);
    }, 800);
    this.timers.push(t0);

    // Each maker arrives at a random time within the window
    for (let i = 0; i < numMakers; i++) {
      const arrivalMs = 1500 + Math.floor(seededRand(now, i + 2) * 12000); // 1.5–13.5s
      const t = this._setTimeout(() => {
        const r = this.store.get(rfq.id);
        if (!r || r.status !== "quoting") return;

        // Price variation around model: ±8%, biased slightly above for realistic spread
        const spread = 0.03 + seededRand(now, i + 10) * 0.05;
        const side = seededRand(now, i + 20) > 0.5 ? 1 : -1;
        const price = Math.max(0.0001, rfq.modelPrice * (1 + side * spread));

        const quote: MakerQuote = {
          id: uuid(),
          maker: MAKER_NAMES[i % MAKER_NAMES.length],
          price: Math.round(price * 10000) / 10000,
          fillable: rfq.totalContracts + Math.floor(seededRand(now, i + 30) * rfq.totalContracts * 2),
          expiresAt: Date.now() + QUOTE_WINDOW_MS,
          isBest: false,
          receivedAt: Date.now(),
        };

        r.quotes = [...r.quotes, quote];
        // Recompute best: cheapest total cost for the taker
        const best = [...r.quotes].sort((a, b) => a.price - b.price)[0];
        r.quotes = r.quotes.map(q => ({ ...q, isBest: q.id === best.id }));
        r.updatedAt = Date.now();
        this._emit(rfq.id, r);
      }, arrivalMs);
      this.timers.push(t);
    }

    // Expire after window
    const tExpire = this._setTimeout(() => {
      const r = this.store.get(rfq.id);
      if (!r || r.status === "accepted" || r.status === "cancelled") return;
      r.status = "expired";
      r.updatedAt = Date.now();
      this._emit(rfq.id, r);
    }, QUOTE_WINDOW_MS + 500);
    this.timers.push(tExpire);
  }

  private _setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    return setTimeout(fn, ms);
  }
}
