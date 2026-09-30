/**
 * RFQ types — Issue #65.
 *
 * Taker-side RFQ workflow: draft → requested → quoting → accepted/expired/cancelled.
 * Typed adapter contract that both real and MSW implementations satisfy.
 */

import type { StrategyLeg } from "../strategies";

export type RfqStatus = "draft" | "requested" | "quoting" | "accepted" | "expired" | "cancelled";

/** A single leg in an RFQ structure, with resolved strike */
export interface RfqLeg {
  side: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  /** Contracts per leg */
  contracts: number;
}

/** A competing quote from a market maker */
export interface MakerQuote {
  id: string;
  /** Pseudonymous maker ID, e.g. "MM-0x1234" */
  maker: string;
  /** Net premium per contract in the structure */
  price: number;
  /** How many contracts the maker can fill */
  fillable: number;
  /** Unix ms timestamp when this quote expires */
  expiresAt: number;
  /** Whether this is the best (lowest net cost for buyer) quote */
  isBest: boolean;
  receivedAt: number;
}

/** Full RFQ lifecycle record */
export interface RfqRecord {
  id: string;
  underlying: string;
  legs: RfqLeg[];
  /** Total contracts requested */
  totalContracts: number;
  /** Optional limit price (buyer's ceiling / seller's floor) */
  limitPrice: number | null;
  status: RfqStatus;
  quotes: MakerQuote[];
  /** Best quote at time of acceptance */
  acceptedQuote: MakerQuote | null;
  /** Model price at time of request (local BS estimate) */
  modelPrice: number;
  /** Unix ms timestamp when the quoting window expires */
  quoteWindowExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Create RFQ request payload */
export interface CreateRfqParams {
  underlying: string;
  legs: RfqLeg[];
  totalContracts: number;
  limitPrice: number | null;
  modelPrice: number;
}

/** Accept a quote */
export interface AcceptQuoteParams {
  rfqId: string;
  quoteId: string;
}

/** RFQ adapter interface — implemented by MockRfqAdapter and (future) real WS adapter */
export interface RfqAdapter {
  /** Submit a new RFQ */
  createRfq(params: CreateRfqParams): Promise<RfqRecord>;
  /** Accept a maker quote */
  acceptQuote(params: AcceptQuoteParams): Promise<RfqRecord>;
  /** Cancel an open RFQ */
  cancelRfq(rfqId: string): Promise<RfqRecord>;
  /** Subscribe to quote updates for a given RFQ. Returns unsubscribe fn. */
  subscribeToQuotes(rfqId: string, onUpdate: (rfq: RfqRecord) => void): () => void;
  /** Get RFQ history */
  listRfqs(): Promise<RfqRecord[]>;
}

/** Build RfqLegs from a strategy template by resolving offsets against spot */
export function strategyLegsToRfqLegs(
  legs: StrategyLeg[],
  spot: number,
  contracts: number
): RfqLeg[] {
  return legs.map(leg => ({
    side: leg.side,
    action: leg.action,
    strike: Math.round(spot * leg.strikeOffset * 100) / 100,
    contracts,
  }));
}
