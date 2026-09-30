import { EXPIRIES, MARKETS } from "./pricing";
import { STRATEGY_TEMPLATES } from "./strategies";

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

const posNumber = (raw: string | null, max: number): number | null => {
  if (raw === null || !/^\d{1,12}(\.\d{1,8})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

export function parseTerminalUrl(params: { get(name: string): string | null }): TerminalUrlState {
  const u = params.get("u");
  const expRaw = params.get("exp");
  const tab = params.get("tab");
  const strategy = params.get("strategy");
  const exp = expRaw && /^\d{1,3}$/.test(expRaw) ? Number(expRaw) : null;
  const qty = posNumber(params.get("qty"), MAX_QTY);
  return {
    u: u && MARKETS.some((m) => m.sym === u) ? u : URL_DEFAULTS.u,
    exp: exp !== null && EXPIRIES.some((e) => e.days === exp) ? exp : URL_DEFAULTS.exp,
    tab: (VIEW_TABS as readonly string[]).includes(tab ?? "") ? (tab as ViewTab) : URL_DEFAULTS.tab,
    strategy: strategy && STRATEGY_TEMPLATES.some((t) => t.id === strategy) ? strategy : null,
    qty: qty !== null && Number.isInteger(qty) ? qty : URL_DEFAULTS.qty,
    strike: posNumber(params.get("strike"), MAX_STRIKE),
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
