import { wsUrl } from "../api/client";
import type { SpotResponse } from "../api/types";
import { RealtimeClient } from "./client";

export * from "./client";

// Spot feed ticks ~every 2s (see ws.ts).
export const realtime = new RealtimeClient();
realtime.registerChannel("spot", {
  url: () => wsUrl("/api/v1/ws/spot"),
  parse: (raw) => JSON.parse(raw) as SpotResponse,
  tickIntervalMs: 2000,
});
