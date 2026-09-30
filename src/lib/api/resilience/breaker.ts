import { CircuitOpenError, RateLimitedError, TimeoutError } from "./errors";
import { apiHealth, type BreakerState } from "./health";
import { isAbortError, originOf, type Middleware } from "./types";

export interface BreakerOptions {
  /** Consecutive failures that trip closed → open. */
  failureThreshold?: number;
  /** First open period; doubles on every failed half-open probe. */
  cooldownMs?: number;
  maxCooldownMs?: number;
  now?: () => number;
}

/**
 * Per-origin circuit breaker (https://martinfowler.com/bliki/CircuitBreaker.html).
 *
 *   closed ──N consecutive failures──▶ open ──cooldown elapsed──▶ half-open
 *     ▲                                  ▲                          │
 *     └──────── probe succeeds ──────────┴──── probe fails ◀────────┘
 *
 * Failure = network error, timeout, or 5xx (except 501). 4xx and 429 are the
 * server working as intended and are neutral. Caller aborts are neutral.
 * While open (or while a half-open probe is in flight) requests fail fast
 * with CircuitOpenError without touching the network. Also enforces an active
 * Retry-After window (RateLimitedError) so one throttled tab can't keep hammering.
 */
export class CircuitBreaker {
  state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private cooldown: number;
  private probeInFlight = false;

  constructor(
    readonly origin: string,
    private readonly opts: Required<BreakerOptions>,
  ) {
    this.cooldown = opts.cooldownMs;
  }

  get retryAt(): number {
    return this.openedAt + this.cooldown;
  }

  /** Returns true if this call is the half-open probe. Throws if the circuit rejects it. */
  acquire(): boolean {
    if (this.state === "open") {
      if (this.opts.now() < this.retryAt) throw new CircuitOpenError(this.origin, this.retryAt);
      this.transition("half-open");
    }
    if (this.state === "half-open") {
      if (this.probeInFlight) throw new CircuitOpenError(this.origin, this.retryAt);
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  onSuccess(probe: boolean) {
    if (probe) this.probeInFlight = false;
    this.failures = 0;
    this.cooldown = this.opts.cooldownMs;
    if (this.state !== "closed") this.transition("closed");
  }

  onFailure(probe: boolean) {
    if (probe) {
      this.probeInFlight = false;
      this.cooldown = Math.min(this.cooldown * 2, this.opts.maxCooldownMs);
      this.trip();
      return;
    }
    this.failures++;
    if (this.state === "closed" && this.failures >= this.opts.failureThreshold) this.trip();
  }

  /** Neither success nor failure (abort, 4xx) — just release a probe slot. */
  onNeutral(probe: boolean) {
    if (probe) {
      this.probeInFlight = false;
      // Undecided probe: go back to open with the same cooldown restarting now.
      this.trip();
    }
  }

  private trip() {
    this.openedAt = this.opts.now();
    this.transition("open");
  }

  private transition(state: BreakerState) {
    this.state = state;
    apiHealth.setBreaker(this.origin, state, state === "open" ? this.retryAt : null);
  }
}

export function isBreakerFailureStatus(status: number): boolean {
  return status >= 500 && status !== 501;
}

export function withBreaker(options: BreakerOptions = {}): Middleware & { breakers: Map<string, CircuitBreaker> } {
  const opts: Required<BreakerOptions> = {
    failureThreshold: options.failureThreshold ?? 5,
    cooldownMs: options.cooldownMs ?? 15_000,
    maxCooldownMs: options.maxCooldownMs ?? 120_000,
    now: options.now ?? Date.now,
  };
  const breakers = new Map<string, CircuitBreaker>();

  const mw: Middleware = (next) => async (req) => {
    const origin = originOf(req.url);
    let breaker = breakers.get(origin);
    if (!breaker) breakers.set(origin, (breaker = new CircuitBreaker(origin, opts)));

    const limitedUntil = apiHealth.get(origin).rateLimitedUntil;
    if (limitedUntil !== null) {
      if (opts.now() < limitedUntil) throw new RateLimitedError(origin, limitedUntil);
      apiHealth.setRateLimited(origin, null);
    }

    const probe = breaker.acquire();
    let res: Response;
    try {
      res = await next(req);
    } catch (err) {
      if (isAbortError(err)) breaker.onNeutral(probe);
      else if (err instanceof TimeoutError || err instanceof TypeError) breaker.onFailure(probe);
      else breaker.onNeutral(probe);
      throw err;
    }
    if (isBreakerFailureStatus(res.status)) breaker.onFailure(probe);
    else if (res.status === 429) breaker.onNeutral(probe);
    else breaker.onSuccess(probe);
    return res;
  };
  return Object.assign(mw, { breakers });
}
