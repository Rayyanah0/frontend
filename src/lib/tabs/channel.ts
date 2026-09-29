import type { SpotResponse } from "../api/types";

/**
 * Cross-tab protocol. Versioned so a stale tab running older code can
 * ignore messages it doesn't understand instead of misinterpreting them.
 *
 * Security note: BroadcastChannel is strictly same-origin, so the bearer
 * token in `session` messages is only ever visible to other Zenith tabs
 * of this origin — the same context that can already read it from
 * localStorage (zustand persist). It never crosses origins.
 */
export const PROTOCOL_VERSION = 1;
const CHANNEL_NAME = "zenith-tabs";

export type TabMessage =
  | { type: "session"; address: string | null; token: string | null; network: string | null }
  | { type: "spot"; data: SpotResponse }
  | { type: "spot-demand" }
  | { type: "invalidate"; keys: InvalidationKey[] };

export type InvalidationKey = "account" | "positions";

type Envelope = { v: number; from: string; msg: TabMessage };

export const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

let channel: BroadcastChannel | null = null;
const listeners = new Set<(msg: TabMessage) => void>();

export function tabSyncSupported(): boolean {
  return typeof window !== "undefined" && typeof BroadcastChannel !== "undefined";
}

function ensureChannel(): BroadcastChannel | null {
  if (!tabSyncSupported()) return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent<Envelope>) => {
      const env = e.data;
      // Ignore other protocol versions; own messages are never delivered back by the spec.
      if (!env || env.v !== PROTOCOL_VERSION || env.from === TAB_ID) return;
      listeners.forEach((l) => l(env.msg));
    };
  }
  return channel;
}

export function broadcast(msg: TabMessage): void {
  try {
    ensureChannel()?.postMessage({ v: PROTOCOL_VERSION, from: TAB_ID, msg } satisfies Envelope);
  } catch {
    // Channel closed / structured-clone failure: degrade to single-tab behaviour.
  }
}

/** Subscribe to messages from other tabs. Returns an unsubscribe function. */
export function onTabMessage(listener: (msg: TabMessage) => void): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
