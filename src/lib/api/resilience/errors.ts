// Errors raised by the resilience layer itself (never by the backend).
// They extend ApiError-compatible shapes via `status` so existing
// classifyError() / UI code keeps working without special cases.

export class TimeoutError extends Error {
  readonly status = 408;
  constructor(readonly timeoutMs: number) {
    super(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "TimeoutError";
  }
}

/** Thrown without touching the network while an origin's breaker is open. */
export class CircuitOpenError extends Error {
  readonly status = 503;
  constructor(readonly origin: string, readonly retryAt: number) {
    super("The Zenith backend is degraded — requests are paused briefly.");
    this.name = "CircuitOpenError";
  }
}

/** Thrown without touching the network while an origin is inside a Retry-After window. */
export class RateLimitedError extends Error {
  readonly status = 429;
  constructor(readonly origin: string, readonly retryAt: number) {
    super("Too many requests — waiting before trying again.");
    this.name = "RateLimitedError";
  }
}
