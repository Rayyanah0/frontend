"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type RefObject } from "react";
import { useSpotFeed, type SpotFeedStatus } from "../hooks/useSpotFeed";
import type { SpotResponse } from "../api/types";
import { broadcast, onTabMessage } from "../tabs/channel";
import { useIsLeaderTab } from "../tabs/leader";
import { startSessionSync } from "../tabs/session";

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
 */
export function SpotFeedProvider({ children }: { children: React.ReactNode }) {
  // Lazy: the socket opens on first consumer demand (see useSpotFeedContext),
  // not at root mount, so pages that never show live data never connect.
  const [demanded, setDemanded] = useState(false);
  const request = useCallback(() => setDemanded(true), []);
  const leader = useIsLeaderTab();
  const [remoteDemand, setRemoteDemand] = useState(false);
  const [relayed, setRelayed] = useState<SpotResponse | null>(null);
  // Only the leader tab holds the socket; it also connects when a follower asks.
  const feed = useSpotFeed(leader === true && (demanded || remoteDemand));

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
  feedRef.current = feed.data;
  useEffect(() => {
    if (leader !== true || !feed.data) return;
    const data = feed.data;
    const id = requestAnimationFrame(() => broadcast({ type: "spot", data }));
    return () => cancelAnimationFrame(id);
  }, [leader, feed.data]);

  const value: SpotFeedData =
    leader === false
      ? { data: relayed, status: relayed ? "open" : "connecting", request }
      : { ...feed, request };
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
