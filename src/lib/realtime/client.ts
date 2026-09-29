// Framework-agnostic realtime client. Each (channel, params) pair is a
// ref-counted subscription with its own socket via a ChannelAdapter,
// because the backend currently only exposes /api/v1/ws/spot. See
// docs/realtime-protocol.md for the multiplexed protocol we'd want.

export type RealtimeStatus = "connecting" | "open" | "reconnecting" | "stale" | "closed";

export interface ChannelAdapter {
  /** Socket URL for this channel/params. */
  url(params: unknown): string;
  /** Turn a raw frame into a handler payload; throw to drop the frame. */
  parse(raw: string): unknown;
  /** Expected ms between messages; stale after `staleFactor` x this. */
  tickIntervalMs: number;
}

export interface RealtimeOptions {
  staleFactor?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  WebSocketImpl?: typeof WebSocket;
}

type Handler = (data: unknown) => void;

interface Sub {
  key: string;
  channel: string;
  params: unknown;
  handlers: Set<Handler>;
  socket: WebSocket | null;
  status: RealtimeStatus;
  attempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  staleTimer: ReturnType<typeof setTimeout> | null;
  lastMessageAt: number | null;
}

export class RealtimeClient {
  private adapters = new Map<string, ChannelAdapter>();
  private subs = new Map<string, Sub>();
  private listeners = new Set<() => void>();
  private opts: Required<Omit<RealtimeOptions, "WebSocketImpl">> & { WebSocketImpl?: typeof WebSocket };
  private status: RealtimeStatus = "closed";

  constructor(opts: RealtimeOptions = {}) {
    this.opts = { staleFactor: 3, backoffBaseMs: 1000, backoffMaxMs: 10000, ...opts };
    if (typeof window !== "undefined") {
      // Timers are throttled in background tabs, so re-check on visibility;
      // and go straight to reconnect when the browser comes back online.
      window.addEventListener("online", () => this.reconnectAll());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.checkStale();
      });
    }
  }

  registerChannel(channel: string, adapter: ChannelAdapter) {
    this.adapters.set(channel, adapter);
  }

  /** Aggregate status: worst state across active subscriptions. */
  getStatus = (): RealtimeStatus => this.status;
  subscribeStatus = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  subscribe(channel: string, params: unknown, handler: Handler): () => void {
    const key = `${channel}:${JSON.stringify(params ?? null)}`;
    let sub = this.subs.get(key);
    if (!sub) {
      sub = {
        key, channel, params, handlers: new Set(), socket: null, status: "connecting",
        attempt: 0, retryTimer: null, staleTimer: null, lastMessageAt: null,
      };
      this.subs.set(key, sub);
      this.connect(sub);
    }
    sub.handlers.add(handler);
    let done = false;
    return () => {
      if (done) return; // idempotent (StrictMode double cleanup)
      done = true;
      this.unsubscribe(key, handler);
    };
  }

  unsubscribe(key: string, handler: Handler) {
    const sub = this.subs.get(key);
    if (!sub) return;
    sub.handlers.delete(handler);
    if (sub.handlers.size === 0) {
      this.teardown(sub);
      this.subs.delete(key);
      this.recompute();
    }
  }

  private connect(sub: Sub) {
    const adapter = this.adapters.get(sub.channel);
    if (!adapter) throw new Error(`Unknown realtime channel: ${sub.channel}`);
    this.setSubStatus(sub, sub.attempt === 0 ? "connecting" : "reconnecting");
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    const socket = new WS(adapter.url(sub.params));
    sub.socket = socket;
    socket.onopen = () => this.armStale(sub, adapter);
    socket.onmessage = (event) => {
      sub.lastMessageAt = Date.now();
      sub.attempt = 0;
      this.armStale(sub, adapter);
      this.setSubStatus(sub, "open");
      let data: unknown;
      try {
        data = adapter.parse(event.data);
      } catch {
        return; // malformed frame: drop it, keep the socket
      }
      sub.handlers.forEach((h) => h(data));
    };
    const onDrop = () => {
      if (sub.socket !== socket) return; // superseded
      this.scheduleReconnect(sub);
    };
    socket.onclose = onDrop;
    socket.onerror = onDrop;
  }

  private armStale(sub: Sub, adapter: ChannelAdapter) {
    if (sub.staleTimer) clearTimeout(sub.staleTimer);
    sub.staleTimer = setTimeout(() => this.markStale(sub), adapter.tickIntervalMs * this.opts.staleFactor);
  }

  private markStale(sub: Sub) {
    if (!this.subs.has(sub.key)) return;
    // Half-open sockets look "open" forever: flag stale, then force a reconnect.
    this.setSubStatus(sub, "stale");
    this.scheduleReconnect(sub, true);
  }

  private checkStale() {
    const now = Date.now();
    this.subs.forEach((sub) => {
      const a = this.adapters.get(sub.channel);
      if (a && sub.lastMessageAt && now - sub.lastMessageAt > a.tickIntervalMs * this.opts.staleFactor) this.markStale(sub);
    });
  }

  private scheduleReconnect(sub: Sub, keepStatus = false) {
    if (sub.retryTimer) return;
    this.closeSocket(sub);
    if (sub.staleTimer) clearTimeout(sub.staleTimer);
    if (!keepStatus) this.setSubStatus(sub, "reconnecting");
    // Jittered exponential backoff (full jitter over [50%, 100%]).
    const cap = Math.min(this.opts.backoffMaxMs, this.opts.backoffBaseMs * 2 ** sub.attempt);
    const delay = cap * (0.5 + Math.random() / 2);
    sub.attempt += 1;
    sub.retryTimer = setTimeout(() => {
      sub.retryTimer = null;
      if (this.subs.has(sub.key)) this.connect(sub); // resubscribes the channel
    }, delay);
  }

  private reconnectAll() {
    this.subs.forEach((sub) => {
      if (sub.retryTimer) {
        clearTimeout(sub.retryTimer);
        sub.retryTimer = null;
      }
      this.closeSocket(sub);
      sub.attempt = 0;
      this.connect(sub);
    });
  }

  private closeSocket(sub: Sub) {
    const s = sub.socket;
    sub.socket = null; // detach first so its onclose is ignored
    if (s) {
      s.onopen = s.onmessage = s.onclose = s.onerror = null;
      try {
        s.close();
      } catch {
        // deliberate: closing an already-dead socket can throw; nothing to recover
      }
    }
  }

  private teardown(sub: Sub) {
    if (sub.retryTimer) clearTimeout(sub.retryTimer);
    if (sub.staleTimer) clearTimeout(sub.staleTimer);
    sub.retryTimer = sub.staleTimer = null;
    this.closeSocket(sub);
  }

  private setSubStatus(sub: Sub, status: RealtimeStatus) {
    sub.status = status;
    this.recompute();
  }

  private recompute() {
    const order: RealtimeStatus[] = ["closed", "open", "connecting", "reconnecting", "stale"];
    let worst: RealtimeStatus = "closed";
    let any = false;
    this.subs.forEach((s) => {
      if (!any || order.indexOf(s.status) > order.indexOf(worst)) worst = s.status;
      any = true;
    });
    const next = any ? worst : "closed";
    if (next !== this.status) {
      this.status = next;
      this.listeners.forEach((l) => l());
    }
  }
}
