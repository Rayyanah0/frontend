/**
 * Client-side alert rule engine (Alerts v2).
 *
 * Backend today only supports spot above/below. Richer metrics (P&L %,
 * portfolio Greeks, IV, DTE) are evaluated here while the app is open.
 *
 * Proposed server-side contract (not implemented):
 *   POST /api/v1/alerts/rules
 *   {
 *     metric: "spot"|"iv"|"position_pnl_pct"|"portfolio_delta"|"portfolio_gamma"|"portfolio_vega"|"dte",
 *     operator: "gt"|"lt"|"gte"|"lte",
 *     threshold: number,
 *     underlying?: string,
 *     position_id?: string,
 *     and?: { metric, operator, threshold, ... },
 *     cooldown_secs: number,
 *     hysteresis: number
 *   }
 *   GET /api/v1/alerts/triggers → TriggerEvent[]
 */

export type AlertMetric =
  | "spot"
  | "iv"
  | "position_pnl_pct"
  | "portfolio_delta"
  | "portfolio_gamma"
  | "portfolio_vega"
  | "dte";

export type AlertOperator = "gt" | "lt" | "gte" | "lte";

export interface AlertConditionNode {
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  /** Required for spot / iv / dte / position_pnl_pct. */
  underlying?: string;
  positionId?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: AlertConditionNode;
  and?: AlertConditionNode;
  /** Minimum ms between re-fires. */
  cooldownMs: number;
  /**
   * Extra buffer past the threshold before flipping back (and before
   * re-arming). Prevents flapping when the feed oscillates around the
   * level. Expressed in the same units as the metric.
   */
  hysteresis: number;
  enabled: boolean;
  createdAt: string;
  /** Last time this rule fired (ISO), for cooldown. */
  lastFiredAt: string | null;
  /** Internal: currently in "crossed" state for hysteresis. */
  armed: boolean;
}

export interface MarketState {
  spots: Record<string, number>;
  vols: Record<string, number>;
  /** Feed age in ms; evaluation skips if stale. */
  feedAgeMs: number;
}

export interface PortfolioState {
  netDelta: number;
  netGamma: number;
  netVega: number;
  positions: {
    id: string;
    underlying: string;
    pnlPct: number;
    /** Days to expiry (fractional). */
    dte: number;
    status: "open" | "closed" | "rolled";
  }[];
}

export interface TriggerEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  timestamp: string;
  value: number;
  metric: AlertMetric;
  href: string;
}

const STALE_FEED_MS = 30_000;
export const RULES_STORAGE_KEY = "zenith.alertRules";
export const TRIGGERS_STORAGE_KEY = "zenith.alertTriggers";

export function compare(op: AlertOperator, value: number, threshold: number): boolean {
  switch (op) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
  }
}

/** Inverse side of the threshold used to re-arm after a fire (hysteresis). */
export function clearedWithHysteresis(
  op: AlertOperator,
  value: number,
  threshold: number,
  hysteresis: number
): boolean {
  const h = Math.abs(hysteresis);
  switch (op) {
    case "gt":
    case "gte":
      return value < threshold - h;
    case "lt":
    case "lte":
      return value > threshold + h;
  }
}

export function resolveMetric(
  node: AlertConditionNode,
  market: MarketState,
  portfolio: PortfolioState
): number | null {
  switch (node.metric) {
    case "spot": {
      if (!node.underlying) return null;
      const v = market.spots[node.underlying];
      return v === undefined ? null : v;
    }
    case "iv": {
      if (!node.underlying) return null;
      const v = market.vols[node.underlying];
      return v === undefined ? null : v * 100; // percent
    }
    case "portfolio_delta":
      return portfolio.netDelta;
    case "portfolio_gamma":
      return portfolio.netGamma;
    case "portfolio_vega":
      return portfolio.netVega;
    case "position_pnl_pct": {
      const pos = portfolio.positions.find(p => p.id === node.positionId);
      if (!pos || pos.status !== "open") return null;
      return pos.pnlPct;
    }
    case "dte": {
      if (node.positionId) {
        const pos = portfolio.positions.find(p => p.id === node.positionId);
        if (!pos || pos.status !== "open") return null;
        return pos.dte;
      }
      if (node.underlying) {
        const open = portfolio.positions.filter(
          p => p.underlying === node.underlying && p.status === "open"
        );
        if (open.length === 0) return null;
        return Math.min(...open.map(p => p.dte));
      }
      return null;
    }
  }
}

export interface EvalResult {
  fired: boolean;
  value: number | null;
  /** Updated rule fields (armed / lastFiredAt). */
  next: Pick<AlertRule, "armed" | "lastFiredAt">;
  reason?: string;
}

/**
 * Evaluate a rule once. Returns whether it should fire *now*, applying
 * cooldown and hysteresis. Does not mutate the rule — caller merges `next`.
 */
export function evaluate(
  rule: AlertRule,
  market: MarketState,
  portfolio: PortfolioState,
  nowMs = Date.now()
): EvalResult {
  if (!rule.enabled) {
    return { fired: false, value: null, next: { armed: rule.armed, lastFiredAt: rule.lastFiredAt }, reason: "disabled" };
  }
  if (market.feedAgeMs > STALE_FEED_MS) {
    return { fired: false, value: null, next: { armed: rule.armed, lastFiredAt: rule.lastFiredAt }, reason: "stale_feed" };
  }

  const primary = resolveMetric(rule.condition, market, portfolio);
  if (primary === null) {
    return { fired: false, value: null, next: { armed: rule.armed, lastFiredAt: rule.lastFiredAt }, reason: "missing_metric" };
  }

  let crossed = compare(rule.condition.operator, primary, rule.condition.threshold);
  if (rule.and) {
    const secondary = resolveMetric(rule.and, market, portfolio);
    if (secondary === null) {
      return { fired: false, value: primary, next: { armed: rule.armed, lastFiredAt: rule.lastFiredAt }, reason: "missing_and_metric" };
    }
    crossed = crossed && compare(rule.and.operator, secondary, rule.and.threshold);
  }

  let armed = rule.armed;
  let lastFiredAt = rule.lastFiredAt;

  // Re-arm when price clears the hysteresis band away from the trigger side.
  if (armed && clearedWithHysteresis(rule.condition.operator, primary, rule.condition.threshold, rule.hysteresis)) {
    armed = false;
  }

  if (!crossed) {
    return { fired: false, value: primary, next: { armed, lastFiredAt } };
  }

  // Already armed (still on the wrong side of hysteresis) → don't re-fire.
  if (armed) {
    return { fired: false, value: primary, next: { armed, lastFiredAt } };
  }

  if (lastFiredAt) {
    const elapsed = nowMs - new Date(lastFiredAt).getTime();
    if (elapsed < rule.cooldownMs) {
      return { fired: false, value: primary, next: { armed, lastFiredAt }, reason: "cooldown" };
    }
  }

  armed = true;
  lastFiredAt = new Date(nowMs).toISOString();
  return { fired: true, value: primary, next: { armed, lastFiredAt } };
}

export function hrefForMetric(metric: AlertMetric, underlying?: string): string {
  switch (metric) {
    case "spot":
    case "iv":
      return underlying ? `/options?sym=${underlying}` : "/options";
    case "position_pnl_pct":
    case "portfolio_delta":
    case "portfolio_gamma":
    case "portfolio_vega":
      return "/portfolio";
    case "dte":
      return "/calendar";
  }
}

export function loadRules(): AlertRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AlertRule[]) : [];
  } catch {
    return [];
  }
}

export function saveRules(rules: AlertRule[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
}

export function loadTriggers(): TriggerEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRIGGERS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TriggerEvent[]) : [];
  } catch {
    return [];
  }
}

export function saveTriggers(events: TriggerEvent[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TRIGGERS_STORAGE_KEY, JSON.stringify(events.slice(0, 200)));
}

export function newRuleId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
