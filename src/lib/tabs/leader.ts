"use client";

import { useEffect, useState } from "react";
import { tabSyncSupported } from "./channel";

const LOCK_NAME = "zenith-realtime-leader";

/**
 * Leader election via the Web Locks API: whichever tab holds the lock is
 * the leader; the browser releases it when that tab closes/crashes, and the
 * next queued tab acquires it (failover, no heartbeat or clock needed —
 * so no clock-skew issues, and a sleeping tab keeps the lock only until
 * the browser discards it).
 *
 * `null` = not decided yet (SSR / first render). Without Web Locks or
 * BroadcastChannel every tab reports leader = true, i.e. today's behaviour
 * (each tab holds its own socket).
 *
 * Gap: no BroadcastChannel-only fallback election for browsers with
 * BroadcastChannel but no Web Locks; they fall back to per-tab sockets.
 */
export function useIsLeaderTab(): boolean | null {
  const [leader, setLeader] = useState<boolean | null>(null);

  useEffect(() => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!tabSyncSupported() || !locks) {
      setLeader(true);
      return;
    }
    let release: (() => void) | null = null;
    let cancelled = false;
    locks
      .request(LOCK_NAME, () => {
        if (cancelled) return;
        setLeader(true);
        // Hold the lock until unmount / tab close.
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => setLeader(true));
    setLeader(false);
    return () => {
      cancelled = true;
      release?.();
    };
  }, []);

  return leader;
}
