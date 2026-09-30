"use client";

import { useEffect, useRef, useState } from "react";
import { getLastTickAt, useFeedStatus } from "../lib/hooks/useSpotFeed";
import { useSpotFeedContext } from "../lib/context/SpotFeedContext";
import { useHydrated } from "../lib/useHydrated";
import type { PriceSource } from "../lib/priced";

const STALE_AGE_MS = 6000;
type Pill = "live" | "reconnecting" | "stale" | "offline";

/** Status debounced so sub-second reconnects don't flicker the pill. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    t.current = setTimeout(() => setV(value), value === "live" ? 0 : ms);
    return () => clearTimeout(t.current);
  }, [value, ms]);
  return v;
}

/** Provenance of the spot feed: `live` only once a tick has arrived and the feed is open. */
export function useSpotProvenance(): { source: PriceSource; asOf: number | null; degraded: boolean } {
  const { data } = useSpotFeedContext();
  const status = useFeedStatus();
  const hydrated = useHydrated(); // SSR/first render always shows seed values
  const live = hydrated && !!data && status === "open";
  return { source: live ? "live" : "seed", asOf: live ? getLastTickAt() : null, degraded: !live };
}

export function FeedStatusPill() {
  const rt = useFeedStatus();
  const hydrated = useHydrated();
  const { asOf } = useSpotProvenance();
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const raw: Pill = rt === "open" ? "live" : rt === "stale" ? "stale" : rt === "closed" ? "offline" : "reconnecting";
  const pill = useDebounced(raw, 1000);
  if (!hydrated) return null;

  const age = asOf ? Date.now() - asOf : null;
  const slow = pill === "live" && age !== null && age > STALE_AGE_MS;
  const color = pill === "live" && !slow ? "var(--call)" : pill === "offline" ? "var(--put)" : "var(--atm)";
  const label = slow ? "Stale" : { live: "Live", reconnecting: "Reconnecting", stale: "Stale", offline: "Offline" }[pill];
  return (
    <span
      role="status"
      title={age !== null ? `Last tick ${(age / 1000).toFixed(0)}s ago` : "No live tick received"}
      style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color, textTransform: "uppercase", letterSpacing: "0.06em" }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

export function ProvenanceBadge({ source, asOf }: { source: PriceSource; asOf?: number | null }) {
  const age = asOf ? `${Math.round((Date.now() - asOf) / 1000)}s ago` : "no live tick";
  return (
    <span
      title={`Source: ${source} (${age})`}
      style={{
        fontSize: 9, padding: "1px 5px", textTransform: "uppercase", letterSpacing: "0.06em",
        border: `1px solid ${source === "live" ? "var(--call)" : "var(--atm)"}`,
        color: source === "live" ? "var(--call)" : "var(--atm)",
      }}
    >
      {source}
    </span>
  );
}
