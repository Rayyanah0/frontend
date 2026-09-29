/**
 * Position management rules engine.
 *
 * Rules are evaluated client-side against live-repriced position data.
 * Execution requires explicit user confirmation — no silent auto-trading.
 *
 * Rules persist per wallet via localStorage (documented contract below).
 * A backend endpoint for rule persistence is out of scope for this issue.
 *
 * localStorage key: `zenith_rules_v1`
 * Format: JSON array of ManagementRule objects.
 *
 * Backend contract (future):
 *   POST /api/v1/rules        { rule: ManagementRule }   → ManagementRule
 *   GET  /api/v1/rules        (token-gated)              → ManagementRule[]
 *   DELETE /api/v1/rules/{id}                            → void
 */

import type { Position } from "./api/types";

// ---------------------------------------------------------------------------
// Rule model
// ---------------------------------------------------------------------------

export type RuleConditionType =
  | "pnl_pct_profit"       // close at X% of max profit (e.g. 50% of credit received)
  | "pnl_pct_loss"         // close if loss exceeds X× entry credit
  | "dte_otm"              // roll if DTE <= N and position is OTM
  | "dte_any"              // close/roll regardless of moneyness when DTE <= N
  | "pnl_absolute_profit"  // close when P&L >= $X
  | "pnl_absolute_loss";   // close when P&L <= -$X

export type RuleAction = "close" | "roll_out" | "roll_up" | "roll_down";

export interface ManagementRule {
  id: string;
  /** Human-readable label. */
  name: string;
  /**
   * Target: applies to a specific position ID, or to a strategy_id
   * (every leg in the strategy shares the rule), or "all" for all positions.
   */
  targetPositionId: string | null;
  targetStrategyId: string | null;
  condition: RuleConditionType;
  /** The threshold value (semantics depend on condition type). */
  threshold: number;
  action: RuleAction;
  enabled: boolean;
  createdAt: string; // ISO
  /** Wallet address the rule belongs to. Rules from other wallets are ignored. */
  walletAddress: string;
}

/** A triggered rule that needs user confirmation before it executes. */
export interface RuleAlert {
  rule: ManagementRule;
  positionId: string;
  /** Human-readable description of why it triggered. */
  reason: string;
  /** A short human-readable description of the proposed action. */
  actionDescription: string;
  triggeredAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Rule templates
// ---------------------------------------------------------------------------

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  condition: RuleConditionType;
  threshold: number;
  action: RuleAction;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "tpl_50pct_profit",
    name: "50% Max Profit",
    description: "Close when position has gained 50% of the maximum possible profit (typically applied to short premium positions).",
    condition: "pnl_pct_profit",
    threshold: 50,
    action: "close",
  },
  {
    id: "tpl_200pct_loss",
    name: "2× Credit Loss",
    description: "Close if the unrealized loss exceeds 2× the initial credit received. Caps downside on short premium trades.",
    condition: "pnl_pct_loss",
    threshold: 200,
    action: "close",
  },
  {
    id: "tpl_7dte_otm",
    name: "Roll 7 DTE (if OTM)",
    description: "Roll the position out to the next expiry when 7 days to expiry remain and the position is out of the money.",
    condition: "dte_otm",
    threshold: 7,
    action: "roll_out",
  },
  {
    id: "tpl_21dte_any",
    name: "Close at 21 DTE",
    description: "Close the position when 21 days to expiry remain, regardless of moneyness (theta decay accelerates past 21 DTE).",
    condition: "dte_any",
    threshold: 21,
    action: "close",
  },
];

// ---------------------------------------------------------------------------
// Condition labels
// ---------------------------------------------------------------------------

export const CONDITION_LABELS: Record<RuleConditionType, string> = {
  pnl_pct_profit:      "P&L ≥ X% of max profit",
  pnl_pct_loss:        "Loss ≥ X× entry credit",
  dte_otm:             "DTE ≤ N (OTM only)",
  dte_any:             "DTE ≤ N",
  pnl_absolute_profit: "P&L ≥ $X",
  pnl_absolute_loss:   "P&L ≤ -$X",
};

export const ACTION_LABELS: Record<RuleAction, string> = {
  close:     "Close position",
  roll_out:  "Roll to next expiry",
  roll_up:   "Roll strike up 5%",
  roll_down: "Roll strike down 5%",
};

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export interface MarkedPosition extends Position {
  spot: number;
  currentPremium: number;
  pnl: number;
  pnlPct: number;
}

/**
 * Evaluate all enabled rules against the current live position data.
 *
 * Returns one RuleAlert per (rule, position) pair that is currently triggered.
 * A rule may produce alerts for multiple positions if it targets "all".
 *
 * @param rules      The user's rules for the current wallet address.
 * @param positions  Live-marked positions (repriced against current spot).
 */
export function evaluateRules(
  rules: ManagementRule[],
  positions: MarkedPosition[]
): RuleAlert[] {
  const alerts: RuleAlert[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Determine the set of positions this rule applies to
    const targets = rule.targetPositionId
      ? positions.filter(p => p.id === rule.targetPositionId)
      : rule.targetStrategyId
      ? positions.filter(p => p.strategy_id === rule.targetStrategyId)
      : positions; // "all"

    for (const pos of targets) {
      const alert = checkRule(rule, pos);
      if (alert) alerts.push(alert);
    }
  }

  return alerts;
}

function checkRule(rule: ManagementRule, pos: MarkedPosition): RuleAlert | null {
  const entryTotal = pos.entry_premium * pos.contracts;
  const isOtm =
    (pos.option_type === "call" && pos.spot < pos.strike) ||
    (pos.option_type === "put" && pos.spot > pos.strike);

  let triggered = false;
  let reason = "";

  switch (rule.condition) {
    case "pnl_pct_profit": {
      // For short positions, max profit = full entry credit. Rule fires when
      // we've kept >= threshold% of it (meaning the position has decayed
      // enough — current cost to close is <= (1 - threshold/100) × credit).
      if (entryTotal <= 0) break;
      const pctGained = (pos.pnl / entryTotal) * 100;
      if (pctGained >= rule.threshold) {
        triggered = true;
        reason = `P&L is +${pctGained.toFixed(1)}% of entry, ≥ ${rule.threshold}% target`;
      }
      break;
    }
    case "pnl_pct_loss": {
      // Rule fires when the loss exceeds `threshold`× the initial credit.
      // Only meaningful for short premium positions where entryTotal > 0.
      if (entryTotal <= 0) break;
      const lossMultiple = Math.abs(Math.min(0, pos.pnl)) / entryTotal * 100;
      if (lossMultiple >= rule.threshold) {
        triggered = true;
        reason = `Loss is ${lossMultiple.toFixed(0)}% of entry credit (threshold: ${rule.threshold}%)`;
      }
      break;
    }
    case "dte_otm": {
      if (pos.expiry_days <= rule.threshold && isOtm) {
        triggered = true;
        reason = `${pos.expiry_days}D to expiry with position OTM`;
      }
      break;
    }
    case "dte_any": {
      if (pos.expiry_days <= rule.threshold) {
        triggered = true;
        reason = `${pos.expiry_days}D to expiry`;
      }
      break;
    }
    case "pnl_absolute_profit": {
      if (pos.pnl >= rule.threshold) {
        triggered = true;
        reason = `Unrealized P&L $${pos.pnl.toFixed(2)} ≥ target $${rule.threshold.toFixed(2)}`;
      }
      break;
    }
    case "pnl_absolute_loss": {
      if (pos.pnl <= -rule.threshold) {
        triggered = true;
        reason = `Unrealized loss $${Math.abs(pos.pnl).toFixed(2)} ≥ limit $${rule.threshold.toFixed(2)}`;
      }
      break;
    }
  }

  if (!triggered) return null;

  return {
    rule,
    positionId: pos.id,
    reason,
    actionDescription: `${ACTION_LABELS[rule.action]} — ${pos.underlying} ${pos.option_type} K=${pos.strike} (${pos.expiry_days}D)`,
    triggeredAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Dry-run backtest
// ---------------------------------------------------------------------------

export interface DryRunResult {
  /** Would the rule have triggered on each historical day? */
  triggerDays: string[]; // ISO dates
  /** The P&L at the point the rule first would have triggered. */
  triggerPnl: number | null;
  /** Approximate premium saved (vs holding to expiry) if closed at trigger point. */
  estimatedBenefit: number | null;
  /** Summary message. */
  summary: string;
}

/**
 * Dry-run a rule against a position's price history since open.
 *
 * `priceHistory` is an array of `{date, premium}` pairs, oldest first,
 * representing the position's mark-to-market premium at each daily close.
 *
 * This is a simplified backtest: it replays the rule condition day by day
 * against the position's historical mark.
 */
export function dryRunRule(
  rule: ManagementRule,
  pos: Position,
  priceHistory: Array<{ date: string; premium: number }>
): DryRunResult {
  const triggerDays: string[] = [];
  let firstTriggerPnl: number | null = null;
  const entryTotal = pos.entry_premium * pos.contracts;

  for (const { date, premium } of priceHistory) {
    const currentPremium = premium * pos.contracts;
    const pnl = pos.position_type === "short"
      ? entryTotal - currentPremium
      : currentPremium - entryTotal;
    const pctGained = entryTotal > 0 ? (pnl / entryTotal) * 100 : 0;
    const isOtm = false; // simplified — no spot history available in the dry run

    let triggered = false;
    switch (rule.condition) {
      case "pnl_pct_profit":   triggered = pctGained >= rule.threshold; break;
      case "pnl_pct_loss":     triggered = pctGained <= -rule.threshold; break;
      case "pnl_absolute_profit": triggered = pnl >= rule.threshold; break;
      case "pnl_absolute_loss":   triggered = pnl <= -rule.threshold; break;
      // DTE-based rules can't be backtested from premium history alone
      case "dte_any": case "dte_otm": break;
    }

    if (triggered) {
      triggerDays.push(date);
      if (firstTriggerPnl === null) firstTriggerPnl = pnl;
    }
  }

  const lastPremium = priceHistory.at(-1)?.premium ?? pos.entry_premium;
  const finalPnl = pos.position_type === "short"
    ? entryTotal - lastPremium * pos.contracts
    : lastPremium * pos.contracts - entryTotal;
  const estimatedBenefit = firstTriggerPnl !== null ? firstTriggerPnl - finalPnl : null;

  const summary =
    triggerDays.length === 0
      ? "Rule would not have triggered on any historical day in this window."
      : `Rule would have triggered on ${triggerDays.length} day${triggerDays.length > 1 ? "s" : ""}, ` +
        `first on ${triggerDays[0]}. ` +
        (firstTriggerPnl !== null ? `P&L at first trigger: $${firstTriggerPnl.toFixed(2)}.` : "") +
        (estimatedBenefit !== null && estimatedBenefit > 0
          ? ` Estimated benefit vs hold-to-expiry: +$${estimatedBenefit.toFixed(2)}.`
          : "");

  return { triggerDays, triggerPnl: firstTriggerPnl, estimatedBenefit, summary };
}

// ---------------------------------------------------------------------------
// LocalStorage persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "zenith_rules_v1";

export function loadRules(walletAddress: string): ManagementRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as ManagementRule[];
    return all.filter(r => r.walletAddress === walletAddress);
  } catch {
    return [];
  }
}

export function saveRule(rule: ManagementRule): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all: ManagementRule[] = raw ? JSON.parse(raw) : [];
    const idx = all.findIndex(r => r.id === rule.id);
    if (idx >= 0) all[idx] = rule;
    else all.push(rule);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
  }
}

export function deleteRule(id: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const all = (JSON.parse(raw) as ManagementRule[]).filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

export function makeRuleId(): string {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
