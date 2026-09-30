import { EXPIRIES, MARKETS } from "./pricing";
import { STRATEGY_TEMPLATES } from "./strategies";
import type { z } from "zod";
import { integerSchema, priceSchema, quantitySchema } from "./validation/schemas";

/**
 * URL-addressable terminal state. Every param is validated against an
 * allowlist / numeric range; anything invalid falls back to the default and
 * is never echoed back into the URL unsanitized (we always re-serialize from
 * the parsed, typed value, never from the raw string).
 */
export const VIEW_TABS = ["chain", "positions", "strategies", "surface"] as const;
export type ViewTab = (typeof VIEW_TABS)[number];

export interface TerminalUrlState {
  u: string;
  exp: number; // expiry days
  tab: ViewTab;
  strategy: string | null;
  qty: number;
  strike: number | null;
}

export const URL_DEFAULTS: TerminalUrlState = {
  u: "XLM",
  exp: 30,
  tab: "chain",
  strategy: null,
  qty: 1,
  strike: null,
};

const MAX_QTY = 1_000_000;
const MAX_STRIKE = 1_000_000_000;

// URL params use the same shared schemas as the form inputs
// (src/lib/validation). URLs are locale-independent, so parse as en-US and
// additionally require the canonical plain-decimal spelling ("1e3", "1,000",
// "0x10", " 5" are all rejected rather than reinterpreted).
const URL_LOCALE = { locale: "en-US" } as const;
const qtyParam = quantitySchema({ step: 1, min: 1, max: MAX_QTY, ...URL_LOCALE });
const strikeParam = priceSchema({ gt: 0, max: MAX_STRIKE, maxDecimals: 8, ...URL_LOCALE });
const expParam = integerSchema({ min: 0, max: 999, ...URL_LOCALE });
const CANONICAL_DECIMAL = /^\d{1,12}(\.\d{1,8})?$/;

function parseParam<T>(schema: z.ZodType<T, z.ZodTypeDef, string>, raw: string | null): T | null {
  if (raw === null || !CANONICAL_DECIMAL.test(raw)) return null;
  const r = schema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseTerminalUrl(params: { get(name: string): string | null }): TerminalUrlState {
  const u = params.get("u");
  const tab = params.get("tab");
  const strategy = params.get("strategy");
  const exp = parseParam(expParam, params.get("exp"));
  const qty = parseParam(qtyParam, params.get("qty"));
  return {
    u: u && MARKETS.some((m) => m.sym === u) ? u : URL_DEFAULTS.u,
    exp: exp !== null && EXPIRIES.some((e) => e.days === exp) ? exp : URL_DEFAULTS.exp,
    tab: (VIEW_TABS as readonly string[]).includes(tab ?? "") ? (tab as ViewTab) : URL_DEFAULTS.tab,
    strategy: strategy && STRATEGY_TEMPLATES.some((t) => t.id === strategy) ? strategy : null,
    qty: qty ?? URL_DEFAULTS.qty,
    strike: parseParam(strikeParam, params.get("strike")),
  };
}

/** Serialize to a query string, omitting values equal to their defaults. */
export function serializeTerminalUrl(s: TerminalUrlState): string {
  const q = new URLSearchParams();
  if (s.u !== URL_DEFAULTS.u) q.set("u", s.u);
  if (s.exp !== URL_DEFAULTS.exp) q.set("exp", String(s.exp));
  if (s.tab !== URL_DEFAULTS.tab) q.set("tab", s.tab);
  if (s.strategy) q.set("strategy", s.strategy);
  if (s.qty !== URL_DEFAULTS.qty) q.set("qty", String(s.qty));
  if (s.strike !== null) q.set("strike", String(s.strike));
  return q.toString();
}

/** Absolute shareable link reproducing the given state. */
export function buildShareUrl(origin: string, path: string, s: TerminalUrlState): string {
  const qs = serializeTerminalUrl(s);
  return `${origin}${path}${qs ? `?${qs}` : ""}`;
}
