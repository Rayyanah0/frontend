"use client";

/**
 * useLivePnL — throttled, per-row live P&L and Greeks streaming.
 *
 * Reprices every open position at most 4× per second using the current
 * spot/vol data from the shared WebSocket feed. Returns:
 *   - `marked`: positions with live P&L, Greeks, and flash directions
 *   - `totalPnl`: portfolio-wide unrealized P&L
 *   - `announcementSummary`: a string safe to put in an aria-live region,
 *     updated at most every 30 s or on a significant change
 *
 * "Significant change" is defined as a totalPnl move of ≥ $1 or ≥ 1%.
 *
 * Accessibility: callers should render the announcementSummary in a
 * `role="status" aria-live="polite" aria-atomic="true"` element. The
 * element should be visually hidden but remain in the DOM so screen readers
 * can announce it. A reduced-motion media query is respected via CSS — this
 * hook does not read window.matchMedia.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Position } from "../api/types";
import { MARKETS, bs, smileVol } from "../pricing";

export type FlashDir = "up" | "down" | null;

export interface LivePosition extends Position {
  spot: number;
  currentPremium: number;
  pnl: number;
  pnlPct: number;
  liveDelta: number;
  liveGamma: number;
  liveTheta: number;
  liveVega: number;
  /** Which direction did pnl change since the last render? Used for flash animation. */
  pnlFlash: FlashDir;
  /** Which direction did currentPremium change? */
  premiumFlash: FlashDir;
}

function reprice(
  pos: Position,
  spots: Record<string, number>,
  vols: Record<string, number>
): Omit<LivePosition, "pnlFlash" | "premiumFlash"> {
  const spot = spots[pos.underlying] ?? MARKETS.find(m => m.sym === pos.underlying)?.price ?? 0;
  const baseVol = vols[pos.underlying] ?? MARKETS.find(m => m.sym === pos.underlying)?.vol ?? 0.5;
  const t = pos.expiry_days / 365;
  const vol = smileVol(baseVol, pos.strike / spot);
  const g = bs(spot, pos.strike, vol, t, pos.option_type === "call");
  const entryTotal = pos.entry_premium * pos.contracts;
  const currentPremium = g.premium * pos.contracts;
  const pnl = pos.position_type === "short" ? entryTotal - currentPremium : currentPremium - entryTotal;
  return {
    ...pos,
    spot,
    currentPremium,
    pnl,
    pnlPct: entryTotal > 0 ? (pnl / entryTotal) * 100 : 0,
    liveDelta: g.delta,
    liveGamma: g.gamma,
    liveTheta: g.theta,
    liveVega: g.vega,
  };
}

interface SpotData {
  prices: Record<string, number>;
  vols: Record<string, number>;
}

/** Maximum 4 renders per second (250 ms cadence). */
const THROTTLE_MS = 250;

/** Announce to screen readers at most every 30 seconds… */
const ANNOUNCE_INTERVAL_MS = 30_000;
/** …or when totalPnl moves by this much absolutely. */
const ANNOUNCE_SIGNIFICANT_DELTA = 1.0;
/** …or when totalPnl moves by this percentage. */
const ANNOUNCE_SIGNIFICANT_PCT = 0.01;

export function useLivePnL(
  positions: Position[],
  spotData: SpotData | null
): {
  marked: LivePosition[];
  totalPnl: number;
  announcementSummary: string;
} {
  const [marked, setMarked] = useState<LivePosition[]>([]);
  const [totalPnl, setTotalPnl] = useState(0);
  const [announcementSummary, setAnnouncementSummary] = useState("");

  // Refs so the throttle callback can read current values without stale closures
  const spotDataRef = useRef(spotData);
  const positionsRef = useRef(positions);
  const prevMarkedRef = useRef<Map<string, Omit<LivePosition, "pnlFlash" | "premiumFlash">>>(new Map());
  const lastAnnouncedPnlRef = useRef<number | null>(null);
  const lastAnnouncedAtRef = useRef<number>(0);
  const pendingRef = useRef(false);

  spotDataRef.current = spotData;
  positionsRef.current = positions;

  const compute = useCallback(() => {
    pendingRef.current = false;
    const sd = spotDataRef.current;
    const spots: Record<string, number> = sd?.prices ?? {};
    const vols: Record<string, number> = sd?.vols ?? {};
    const pos = positionsRef.current;

    let total = 0;
    const next: LivePosition[] = pos.map(p => {
      const fresh = reprice(p, spots, vols);
      const prev = prevMarkedRef.current.get(p.id);
      const pnlFlash: FlashDir = prev
        ? fresh.pnl > prev.pnl + 0.0001 ? "up"
        : fresh.pnl < prev.pnl - 0.0001 ? "down" : null
        : null;
      const premiumFlash: FlashDir = prev
        ? fresh.currentPremium > prev.currentPremium + 0.0001 ? "up"
        : fresh.currentPremium < prev.currentPremium - 0.0001 ? "down" : null
        : null;
      prevMarkedRef.current.set(p.id, fresh);
      total += fresh.pnl;
      return { ...fresh, pnlFlash, premiumFlash };
    });

    setMarked(next);
    setTotalPnl(total);

    // Accessibility announcement — throttled and only on significant change
    const now = Date.now();
    const prevTotal = lastAnnouncedPnlRef.current;
    const timeSinceLast = now - lastAnnouncedAtRef.current;
    const isSignificant =
      prevTotal === null ||
      Math.abs(total - prevTotal) >= ANNOUNCE_SIGNIFICANT_DELTA ||
      (Math.abs(prevTotal) > 0 && Math.abs((total - prevTotal) / prevTotal) >= ANNOUNCE_SIGNIFICANT_PCT);
    const isTimeToAnnounce = timeSinceLast >= ANNOUNCE_INTERVAL_MS;

    if (isSignificant || isTimeToAnnounce) {
      const sign = total >= 0 ? "+" : "−";
      const abs = Math.abs(total).toFixed(2);
      setAnnouncementSummary(
        `Portfolio unrealized P&L: ${sign}$${abs}. ${pos.length} open position${pos.length === 1 ? "" : "s"}.`
      );
      lastAnnouncedPnlRef.current = total;
      lastAnnouncedAtRef.current = now;
    }
  }, []);

  // Throttled scheduler: incoming tick sets a pending flag; the timeout
  // fires one compute at most every THROTTLE_MS, coalescing rapid updates.
  const scheduleCompute = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setTimeout(compute, THROTTLE_MS);
  }, [compute]);

  // Re-schedule whenever spot data changes (the WebSocket tick)
  useEffect(() => {
    scheduleCompute();
  }, [spotData, scheduleCompute]);

  // Also recompute immediately when positions change (new open/close)
  useEffect(() => {
    prevMarkedRef.current = new Map(); // reset flash state
    compute();
  }, [positions, compute]);

  return { marked, totalPnl, announcementSummary };
}
