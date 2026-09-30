"use client";

import { useEffect, useRef, useState } from "react";
import { useOnline } from "../lib/hooks/useOnline";
import { useSpotFeedContext } from "../lib/context/SpotFeedContext";
import { useWalletStore } from "../lib/store/wallet";
import { clearSnapshots, loadSnapshot, saveSnapshot } from "../lib/offlineSnapshot";
import type { SpotResponse } from "../lib/api/types";

/**
 * Registers the service worker, shows the offline banner (with the last-known
 * prices from the IndexedDB snapshot) and the "new version available" prompt.
 * Trade confirmation dialogs disable themselves while offline (see ConfirmDialog).
 */
export function PwaShell() {
  const online = useOnline();
  const { data } = useSpotFeedContext();
  const address = useWalletStore((s) => s.address);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [stale, setStale] = useState<{ savedAt: number; data: SpotResponse } | null>(null);
  const key = address ?? "anon";
  const lastAddress = useRef<string | null>(address);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
        });
      });
    }).catch(() => { /* SW is an enhancement only */ });
  }, []);

  // Persist the latest live prices; wipe every snapshot when the wallet disconnects.
  useEffect(() => {
    if (online && data) saveSnapshot(key, data);
  }, [data, online, key]);
  useEffect(() => {
    if (lastAddress.current && !address) clearSnapshots();
    lastAddress.current = address;
  }, [address]);
  useEffect(() => {
    if (!online) loadSnapshot<SpotResponse>(key).then((s) => setStale(s ?? null));
  }, [online, key]);

  const bar: React.CSSProperties = {
    position: "fixed", left: 0, right: 0, zIndex: 200, padding: "6px 12px", fontSize: 11,
    fontFamily: "var(--font-mono)", textAlign: "center",
  };
  return (
    <>
      {!online && (
        <div role="status" style={{ ...bar, top: 0, background: "var(--put)", color: "var(--bg)" }}>
          Offline — showing last-known data
          {stale ? ` from ${new Date(stale.savedAt).toLocaleTimeString([], { hour12: false })}` : ""}. Trading is disabled.
        </div>
      )}
      {waiting && (
        <div role="status" style={{ ...bar, bottom: 0, background: "var(--brand)", color: "var(--bg)" }}>
          New version available —{" "}
          <button onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })} style={{ textDecoration: "underline", fontWeight: 700 }}>
            reload
          </button>
        </div>
      )}
    </>
  );
}
