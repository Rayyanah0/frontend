"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSpotFeed, type SpotFeedStatus } from "../hooks/useSpotFeed";
import type { SpotResponse } from "../api/types";
import { broadcast, onTabMessage } from "../tabs/channel";
import { useIsLeaderTab } from "../tabs/leader";
import { startSessionSync } from "../tabs/session";
import { useIntegrityGuard } from "../integrity/useIntegrityGuard";

interface SpotFeedData {
  data: SpotResponse | null;
  status: SpotFeedStatus;
  /** Ask the provider to open the shared socket (idempotent). */
  request: () => void;
}

const SpotFeedContext = createContext<SpotFeedData | null>(null);

/**
 * One shared WebSocket connection for the whole app, mounted at the
 * root — options and portfolio both need live spot/vol data, and
 * without this each would open its own independent socket to the same
 * feed for no benefit (same broadcast, same reconnect logic, just
 * duplicated).
 *
 * Integrity guard: every incoming tick from the leader socket is passed
 * through the validateTick pipeline before being stored and relayed to
 * follower tabs.  Rejected ticks are silently dropped (they are logged via
 * the sampled monitoring emission inside useIntegrityGuard).
 */
export function SpotFeedProvider({ children }: { children: React.ReactNode }) {
  // Lazy: the socket opens on first consumer demand (see useSpotFeedContext),
  // not at root mount, so pages that never show live data never connect.
  const [demanded, setDemanded] = useState(false);
  const request = useCallback(() => setDemanded(true), []);
  const leader = useIsLeaderTab();
  const [remoteDemand, setRemoteDemand] = useState(false);
  const [relayed, setRelayed] = useState<SpotResponse | null>(null);

  // ── Integrity guard (leader tab only) ──────────────────────────────────────
  // The guard lives only in the leader because followers receive already-
  // validated snapshots via the broadcast channel.  Non-leaders skip
  // validation to avoid double-counting rejections in the store.
  const { processTick, handleReconnect } = useIntegrityGuard();

  // Raw feed from useSpotFeed; we'll filter it before exposing it.
  const rawFeed = useSpotFeed(leader === true && (demanded || remoteDemand));

  // Validated data: only accept ticks that pass the integrity check.
  const [validatedData, setValidatedData] = useState<SpotResponse | null>(null);
  const prevStatusRef = useRef<SpotFeedStatus>("closed");

  useEffect(() => {
    if (leader !== true) return;

    // Detect a reconnect: if the status transitions from a non-open state
    // back to open, reset baselines so the first post-reconnect tick seeds
    // a fresh median.
    if (
      prevStatusRef.current !== "open" &&
      rawFeed.status === "open"
    ) {
      handleReconnect();
    }
    prevStatusRef.current = rawFeed.status;

    if (!rawFeed.data) return;

    const accepted = processTick(rawFeed.data);
    if (accepted !== null) {
      setValidatedData(accepted);
    }
    // If processTick returns null the tick is dropped silently — the previous
    // validated snapshot is kept so the UI doesn't blank out.
  }, [leader, rawFeed.data, rawFeed.status, processTick, handleReconnect]);

  useEffect(() => startSessionSync(), []);

  // Followers ask the leader to connect and adopt its relayed snapshots.
  useEffect(() => {
    if (leader === false && demanded) broadcast({ type: "spot-demand" });
  }, [leader, demanded]);
  useEffect(
    () =>
      onTabMessage((msg) => {
        if (msg.type === "spot") setRelayed(msg.data);
        else if (msg.type === "spot-demand") {
          setRemoteDemand(true);
          if (feedRef.current) broadcast({ type: "spot", data: feedRef.current });
        }
      }),
    []
  );

  // Leader relays at most one message per animation frame.
  const feedRef = useRef<SpotResponse | null>(null);
  feedRef.current = validatedData;
  useEffect(() => {
    if (leader !== true || !validatedData) return;
    const data = validatedData;
    const id = requestAnimationFrame(() => broadcast({ type: "spot", data }));
    return () => cancelAnimationFrame(id);
  }, [leader, validatedData]);

  // Memoize the context value to prevent all consumers from re-rendering
  // when the provider re-renders for unrelated reasons.  Each field is a
  // stable reference (request is useCallback'd; data/status only change
  // when new WS frames arrive), so the memo hit rate is high.
  const followerData = leader === false ? relayed : null;
  const followerStatus: SpotFeedStatus = relayed ? "open" : "connecting";
  const value = useMemo<SpotFeedData>(
    () =>
      leader === false
        ? { data: followerData, status: followerStatus, request }
        : { data: validatedData, status: rawFeed.status, request },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leader, followerData, followerStatus, validatedData, rawFeed.status, request],
  );
  return <SpotFeedContext.Provider value={value}>{children}</SpotFeedContext.Provider>;
}

/**
 * Consume the shared feed. By default the first consumer to mount triggers
 * the connection. Pass `visibleRef` to defer until that element scrolls
 * into the viewport (IntersectionObserver) — used by the landing preview.
 */
export function useSpotFeedContext(visibleRef?: RefObject<Element | null>): SpotFeedData {
  const ctx = useContext(SpotFeedContext);
  if (!ctx) throw new Error("useSpotFeedContext must be used within SpotFeedProvider");
  const { request } = ctx;
  useEffect(() => {
    const el = visibleRef?.current;
    if (!visibleRef) return request();
    if (!el || typeof IntersectionObserver === "undefined") return request();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        request();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [request, visibleRef]);
  return ctx;
}
