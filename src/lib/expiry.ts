/**
 * Expiry derivation, calendar grouping, settlement helpers, and .ics feed.
 *
 * Authority: when a backend ExpiryInfo.timestamp is available for the
 * (underlying, expiry_days) pair, that absolute UTC timestamp wins.
 * Otherwise we derive opened_at + expiry_days (calendar days, UTC midnight
 * of the open date + N days at 08:00 UTC — matching typical crypto option
 * settlement windows). Documented so on-chain settlement can adopt the
 * same rule later.
 */

import type { ExpiryInfo, Position } from "./api/types";

const MS_DAY = 1000 * 60 * 60 * 24;
/** Fallback settlement hour (UTC) when deriving from opened_at + days. */
const SETTLEMENT_HOUR_UTC = 8;

export function deriveExpiryMs(
  position: Pick<Position, "opened_at" | "expiry_days">,
  expiryInfo?: ExpiryInfo | null
): number {
  if (expiryInfo && Number.isFinite(expiryInfo.timestamp) && expiryInfo.timestamp > 0) {
    // Backend may send seconds or milliseconds.
    return expiryInfo.timestamp < 1e12 ? expiryInfo.timestamp * 1000 : expiryInfo.timestamp;
  }
  const opened = new Date(position.opened_at);
  const y = opened.getUTCFullYear();
  const m = opened.getUTCMonth();
  const d = opened.getUTCDate();
  const base = Date.UTC(y, m, d, SETTLEMENT_HOUR_UTC, 0, 0, 0);
  return base + position.expiry_days * MS_DAY;
}

export function daysRemaining(expiryMs: number, nowMs = Date.now()): number {
  return (expiryMs - nowMs) / MS_DAY;
}

export function countdownLabel(expiryMs: number, nowMs = Date.now()): string {
  const ms = expiryMs - nowMs;
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

export interface ExpiryGroup {
  /** YYYY-MM-DD in UTC. */
  date: string;
  expiryMs: number;
  positions: Position[];
  count: number;
  /** Net premium paid (long +) / collected (short −) at entry. */
  netPremium: number;
  /** Projected intrinsic at current spots, signed by position. */
  projectedIntrinsic: number;
}

function dateKeyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function groupByExpiryDate(
  positions: Position[],
  spots: Record<string, number>,
  expiryLookup?: (p: Position) => ExpiryInfo | null | undefined
): ExpiryGroup[] {
  const map = new Map<string, ExpiryGroup>();
  for (const p of positions) {
    if (p.status !== "open") continue;
    const expiryMs = deriveExpiryMs(p, expiryLookup?.(p));
    const key = dateKeyUTC(expiryMs);
    if (!map.has(key)) {
      map.set(key, {
        date: key,
        expiryMs,
        positions: [],
        count: 0,
        netPremium: 0,
        projectedIntrinsic: 0,
      });
    }
    const g = map.get(key)!;
    g.positions.push(p);
    g.count += 1;
    const prem = p.entry_premium * p.contracts * (p.position_type === "short" ? -1 : 1);
    g.netPremium += prem;
    const spot = spots[p.underlying] ?? 0;
    const intrinsic =
      p.option_type === "call"
        ? Math.max(0, spot - p.strike)
        : Math.max(0, p.strike - spot);
    const signed = intrinsic * p.contracts * (p.position_type === "short" ? -1 : 1);
    // For writers, entry premium is income; projected settlement P&L ≈ premium − intrinsic.
    // For longs: intrinsic − premium. Surface intrinsic exposure here; settlement center has full P&L.
    g.projectedIntrinsic += signed;
  }
  return Array.from(map.values()).sort((a, b) => a.expiryMs - b.expiryMs);
}

export type SettlementOutcome = "ITM" | "OTM" | "ATM";

export interface SettlementRow {
  position: Position;
  expiryMs: number;
  outcome: SettlementOutcome;
  settlementPrice: number;
  realizedPnl: number;
  actionRequired: boolean;
}

export function intrinsicAt(spot: number, strike: number, optionType: "call" | "put"): number {
  return optionType === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

export function settlementOutcome(
  position: Position,
  settlementSpot: number
): SettlementOutcome {
  const intrinsic = intrinsicAt(settlementSpot, position.strike, position.option_type);
  if (intrinsic > 1e-9) return "ITM";
  if (Math.abs(settlementSpot - position.strike) < 1e-9) return "ATM";
  return "OTM";
}

/**
 * Expired open positions (client-derived) plus already-closed/rolled
 * trades whose close fell on/after expiry. Settlement price prefers
 * close_spot, else the live spot map.
 */
export function buildSettlementCenter(
  positions: Position[],
  spots: Record<string, number>,
  nowMs = Date.now(),
  expiryLookup?: (p: Position) => ExpiryInfo | null | undefined
): SettlementRow[] {
  const rows: SettlementRow[] = [];
  for (const p of positions) {
    const expiryMs = deriveExpiryMs(p, expiryLookup?.(p));
    const expired = expiryMs <= nowMs;
    if (!expired && p.status === "open") continue;
    if (p.status === "open" && !expired) continue;
    if (p.status === "open" && expired) {
      const spot = spots[p.underlying] ?? p.entry_spot;
      const intrinsic = intrinsicAt(spot, p.strike, p.option_type);
      const entryTotal = p.entry_premium * p.contracts;
      const settleTotal = intrinsic * p.contracts;
      const realizedPnl =
        p.position_type === "short" ? entryTotal - settleTotal : settleTotal - entryTotal;
      rows.push({
        position: p,
        expiryMs,
        outcome: settlementOutcome(p, spot),
        settlementPrice: spot,
        realizedPnl,
        actionRequired: true,
      });
      continue;
    }
    // Closed / rolled — include if we have settlement info
    if (p.status === "closed" || p.status === "rolled") {
      if (!expired && !(p.closed_at && new Date(p.closed_at).getTime() >= expiryMs - MS_DAY)) {
        // Still show closed trades that have realized pnl near expiry window
        if (p.realized_pnl === null) continue;
      }
      const spot = p.close_spot ?? spots[p.underlying] ?? p.entry_spot;
      rows.push({
        position: p,
        expiryMs,
        outcome: settlementOutcome(p, spot),
        settlementPrice: spot,
        realizedPnl: p.realized_pnl ?? 0,
        actionRequired: false,
      });
    }
  }
  return rows.sort((a, b) => b.expiryMs - a.expiryMs);
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/** RFC 5545 VCALENDAR with one VEVENT per open position expiry. */
export function buildIcsFeed(
  positions: Position[],
  expiryLookup?: (p: Position) => ExpiryInfo | null | undefined
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zenith Options//Expiry Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const now = icsDate(Date.now());
  for (const p of positions.filter(x => x.status === "open")) {
    const expiryMs = deriveExpiryMs(p, expiryLookup?.(p));
    const uid = `expiry-${p.id}@zenith.options`;
    const summary = `${p.underlying} ${p.position_type} ${p.option_type} ${p.strike} exp`;
    const desc = `${p.contracts} contracts · opened ${p.opened_at}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(expiryMs)}`,
      `DTEND:${icsDate(expiryMs + 60 * 60 * 1000)}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function downloadIcs(filename: string, ics: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Positions needing a 24h or 1h reminder given last-notified map. */
export function dueExpiryNotifications(
  positions: Position[],
  notified: Record<string, { h24?: boolean; h1?: boolean }>,
  nowMs = Date.now(),
  expiryLookup?: (p: Position) => ExpiryInfo | null | undefined
): { position: Position; kind: "24h" | "1h"; expiryMs: number }[] {
  const out: { position: Position; kind: "24h" | "1h"; expiryMs: number }[] = [];
  for (const p of positions.filter(x => x.status === "open")) {
    const expiryMs = deriveExpiryMs(p, expiryLookup?.(p));
    const rem = expiryMs - nowMs;
    const flags = notified[p.id] ?? {};
    if (rem > 0 && rem <= 60 * 60 * 1000 && !flags.h1) {
      out.push({ position: p, kind: "1h", expiryMs });
    } else if (rem > 0 && rem <= 24 * 60 * 60 * 1000 && !flags.h24) {
      out.push({ position: p, kind: "24h", expiryMs });
    }
  }
  return out;
}
