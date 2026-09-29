/**
 * Taylor-series Greek P&L attribution (Hull ch. 19).
 *
 * Decomposes the change in mark-to-market premium between a baseline
 * snapshot and the current mark into delta, gamma, theta, vega, and
 * residual contributions.
 *
 * Server-side historical snapshots are out of scope. A future contract
 * would be:
 *   GET /api/v1/portfolio/snapshots?at=<iso>
 *   → { positions: SnapshotPosition[], captured_at: string }
 * where SnapshotPosition mirrors PositionSnapshot below. Until then,
 * baselines are stored in localStorage only.
 */

export interface PositionSnapshot {
  id: string;
  underlying: string;
  option_type: "call" | "put";
  position_type: "long" | "short";
  strike: number;
  contracts: number;
  /** Mark premium per contract at snapshot time. */
  premium: number;
  spot: number;
  iv: number;
  delta: number;
  gamma: number;
  /** Theta per day (matches pricing.ts / BS convention). */
  theta: number;
  /** Vega per 1 vol point (matches pricing.ts). */
  vega: number;
}

export interface AttributionBreakdown {
  id: string;
  underlying: string;
  totalPnl: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  residual: number;
  /** True when |residual| > 10% of |totalPnl|. */
  modelError: boolean;
  /** Position opened after baseline (no before state). */
  openedSinceBaseline: boolean;
  /** Position closed after baseline (no after state). */
  closedSinceBaseline: boolean;
}

export interface AggregateAttribution {
  totalPnl: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  residual: number;
  modelError: boolean;
  byPosition: AttributionBreakdown[];
  /** Waterfall steps: baseline → Δ → Γ → Θ → V → residual → current. */
  waterfall: { label: string; value: number; cumulative: number }[];
}

const MODEL_ERROR_RATIO = 0.1;

function sign(positionType: "long" | "short"): number {
  return positionType === "short" ? -1 : 1;
}

/**
 * Attribute mark P&L for one position between two snapshots.
 * dtDays is calendar days between baseline and now (can be fractional).
 */
export function attributePosition(
  before: PositionSnapshot | null,
  after: PositionSnapshot | null,
  dtDays: number
): AttributionBreakdown | null {
  if (!before && !after) return null;

  if (!before && after) {
    return {
      id: after.id,
      underlying: after.underlying,
      totalPnl: 0,
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      residual: 0,
      modelError: false,
      openedSinceBaseline: true,
      closedSinceBaseline: false,
    };
  }

  if (before && !after) {
    return {
      id: before.id,
      underlying: before.underlying,
      totalPnl: 0,
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      residual: 0,
      modelError: false,
      openedSinceBaseline: false,
      closedSinceBaseline: true,
    };
  }

  const b = before!;
  const a = after!;
  const s = sign(b.position_type);
  const qty = b.contracts;

  // Mark P&L: change in total premium, signed by position direction.
  const totalPnl = s * (a.premium - b.premium) * qty;

  const dS = a.spot - b.spot;
  const dIvPoints = (a.iv - b.iv) * 100; // vega is per 1% vol
  const safeDt = Math.max(0, dtDays);

  // Greeks at baseline (standard Taylor expansion around t0).
  const delta = s * b.delta * dS * qty;
  const gamma = s * 0.5 * b.gamma * dS * dS * qty;
  const theta = s * b.theta * safeDt * qty;
  const vega = s * b.vega * dIvPoints * qty;
  const residual = totalPnl - (delta + gamma + theta + vega);
  const absTotal = Math.abs(totalPnl);
  const modelError = absTotal > 1e-9 && Math.abs(residual) > MODEL_ERROR_RATIO * absTotal;

  return {
    id: b.id,
    underlying: b.underlying,
    totalPnl,
    delta,
    gamma,
    theta,
    vega,
    residual,
    modelError,
    openedSinceBaseline: false,
    closedSinceBaseline: false,
  };
}

export function attribute(
  before: PositionSnapshot[],
  after: PositionSnapshot[],
  dtDays: number
): AggregateAttribution {
  const beforeMap = new Map(before.map(p => [p.id, p]));
  const afterMap = new Map(after.map(p => [p.id, p]));
  const ids = new Set([...Array.from(beforeMap.keys()), ...Array.from(afterMap.keys())]);

  const byPosition: AttributionBreakdown[] = [];
  for (const id of Array.from(ids)) {
    const row = attributePosition(beforeMap.get(id) ?? null, afterMap.get(id) ?? null, dtDays);
    if (row && !row.openedSinceBaseline && !row.closedSinceBaseline) {
      byPosition.push(row);
    } else if (row) {
      byPosition.push(row);
    }
  }

  const sum = (key: keyof Pick<AttributionBreakdown, "totalPnl" | "delta" | "gamma" | "theta" | "vega" | "residual">) =>
    byPosition.reduce((acc, p) => acc + p[key], 0);

  const totalPnl = sum("totalPnl");
  const delta = sum("delta");
  const gamma = sum("gamma");
  const theta = sum("theta");
  const vega = sum("vega");
  const residual = sum("residual");
  const absTotal = Math.abs(totalPnl);
  const modelError =
    absTotal > 1e-9 && Math.abs(residual) > MODEL_ERROR_RATIO * absTotal;

  // Waterfall starts at 0 (baseline relative P&L) and ends at totalPnl.
  let cum = 0;
  const steps: { label: string; value: number; cumulative: number }[] = [
    { label: "Baseline", value: 0, cumulative: 0 },
  ];
  for (const [label, value] of [
    ["Δ", delta],
    ["Γ", gamma],
    ["Θ", theta],
    ["V", vega],
    ["Residual", residual],
  ] as const) {
    cum += value;
    steps.push({ label, value, cumulative: cum });
  }
  steps.push({ label: "Current", value: 0, cumulative: totalPnl });

  return { totalPnl, delta, gamma, theta, vega, residual, modelError, byPosition, waterfall: steps };
}

export const ATTRIBUTION_STORAGE_KEY = "zenith.attribution.baseline";

export interface StoredBaseline {
  capturedAt: string;
  positions: PositionSnapshot[];
}

export function loadBaseline(): StoredBaseline | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredBaseline;
  } catch {
    return null;
  }
}

export function saveBaseline(positions: PositionSnapshot[], capturedAt = new Date().toISOString()): StoredBaseline {
  const baseline: StoredBaseline = { capturedAt, positions };
  if (typeof window !== "undefined") {
    localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(baseline));
  }
  return baseline;
}

export function clearBaseline() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(ATTRIBUTION_STORAGE_KEY);
  }
}

/** Days (fractional) between two ISO timestamps. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / (1000 * 60 * 60 * 24));
}
