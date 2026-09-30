"use client";

import { useEffect, useRef, useState } from "react";
import { getChain } from "../api/market";
import { wsUrl } from "../api/client";
import type { OptionChainEntry } from "../api/types";
import { entryToRow, mergeChain, type ChainRowData } from "../chainRows";

export type ChainMode = "stream" | "poll" | "fallback";

const POLL_MS = 4000;
const MAX_BACKOFF_MS = 30000;

/**
 * Chain data for `sym`/`days`. Expected realtime channel `chain:{sym}:{days}`
 * at `/api/v1/ws/chain/{sym}/{days}`; each frame is either a full snapshot
 * `{"type":"snapshot","rows":OptionChainEntry[]}` or a delta
 * `{"type":"delta","rows":OptionChainEntry[]}` containing only changed strikes.
 * If the socket can't open, falls back to visibility-aware polling (paused
 * while the tab is hidden, exponential backoff on errors). `localFallback`
 * builds a local Black-Scholes chain and is only used when the backend is
 * unreachable. Every update is tagged with the (sym, days) key it was requested
 * for, so a response for a previous symbol/expiry is never rendered.
 */
export function useChainFeed(sym: string, days: number, localFallback: () => ChainRowData[]) {
  const [state, setState] = useState<{ key: string; rows: ChainRowData[] }>({ key: "", rows: [] });
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ChainMode>("poll");
  const fallbackRef = useRef(localFallback);
  fallbackRef.current = localFallback;
  const key = `${sym}:${days}`;

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let streaming = false;
    setLoading(true);

    const apply = (rows: ChainRowData[], m: ChainMode) => {
      if (cancelled) return;
      setState((s) => ({ key, rows: mergeChain(s.key === key ? s.rows : [], rows) }));
      setMode(m);
      setLoading(false);
    };

    const applyDelta = (entries: OptionChainEntry[]) => {
      if (cancelled) return;
      setState((s) => {
        const base = s.key === key ? s.rows : [];
        const map = new Map(base.map((r) => [r.strike, r]));
        entries.forEach((e) => map.set(e.strike, entryToRow(e)));
        const next = Array.from(map.values()).sort((a, b) => a.strike - b.strike);
        return { key, rows: mergeChain(base, next) };
      });
    };

    const poll = async () => {
      if (cancelled || streaming) return;
      if (typeof document !== "undefined" && document.hidden) return; // resumed by visibilitychange
      try {
        const entries = await getChain(sym, days);
        failures = 0;
        apply(entries.map(entryToRow), "poll");
      } catch {
        failures++;
        // Nothing to show yet: render the local calc so the chain isn't empty.
        setState((s) => {
          if (s.key === key && s.rows.length > 0) return s;
          return { key, rows: fallbackRef.current() };
        });
        setMode("fallback");
        setLoading(false);
      }
      if (!cancelled && !streaming) {
        timer = setTimeout(poll, Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS));
      }
    };

    const onVisibility = () => {
      if (!document.hidden && !streaming) {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    try {
      socket = new WebSocket(wsUrl(`/api/v1/ws/chain/${encodeURIComponent(sym)}/${days}`));
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { type: "snapshot" | "delta"; rows: OptionChainEntry[] };
          if (!streaming) { streaming = true; clearTimeout(timer); }
          if (msg.type === "delta") applyDelta(msg.rows);
          else apply(msg.rows.map(entryToRow), "stream");
        } catch { /* ignore malformed frame */ }
      };
      const drop = () => {
        if (cancelled) return;
        streaming = false;
        socket = null;
        poll();
      };
      socket.onclose = drop;
      socket.onerror = drop;
    } catch {
      poll();
    }
    // Poll immediately too, so the first paint doesn't wait on the socket;
    // it stops as soon as a stream frame arrives.
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (socket) { socket.onclose = null; socket.onerror = null; socket.close(); }
    };
  }, [key, sym, days]);

  // Never expose rows that belong to a different symbol/expiry.
  const rows = state.key === key ? state.rows : [];
  return { chain: rows, loading: loading && rows.length === 0, mode };
}
