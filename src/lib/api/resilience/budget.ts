/**
 * Retry budget (token bucket, after Finagle's RetryBudget): every request
 * deposits `ratio` tokens, every retry withdraws one. Retries therefore stay
 * a bounded fraction of traffic — when the backend is struggling and most
 * requests fail, the budget drains and we stop amplifying load.
 *
 * The bucket starts with `reserve` tokens so a fresh (low-traffic) client can
 * still retry the occasional blip.
 */
export interface RetryBudgetOptions {
  /** Tokens deposited per request (0.2 ⇒ retries ≤ ~20% of requests). */
  ratio?: number;
  /** Starting balance. */
  reserve?: number;
  /** Bucket cap, so a long healthy period can't bank an unbounded burst. */
  max?: number;
}

export class RetryBudget {
  private tokens: number;
  readonly ratio: number;
  readonly reserve: number;
  readonly max: number;

  constructor({ ratio = 0.2, reserve = 3, max = 10 }: RetryBudgetOptions = {}) {
    this.ratio = ratio;
    this.reserve = reserve;
    this.max = Math.max(max, reserve);
    this.tokens = reserve;
  }

  /** Record an original (non-retry) request. */
  deposit(): void {
    this.tokens = Math.min(this.max, this.tokens + this.ratio);
  }

  /** Try to spend a token on a retry. */
  tryWithdraw(): boolean {
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  get balance(): number {
    return this.tokens;
  }
}
