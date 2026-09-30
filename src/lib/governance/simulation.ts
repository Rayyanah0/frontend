/**
 * simulation.ts — Issue #89: pre-submission simulation preview.
 *
 * For every action in a draft the wizard shows what will actually change,
 * e.g. "Put collateral ratio: 110% → 120%".  That needs two things:
 *
 *   1. The current on-chain value for each parameter, read through the
 *      Soroban RPC layer.
 *   2. A diff between that value and the proposed one, formatted with the
 *      unit/scale declared on the param spec in `actions.ts`.
 *
 * Reads are deliberately best-effort: a proposal must still be submittable when
 * the RPC is unreachable, so a failed read degrades to an "unknown" current
 * value rather than blocking the wizard.
 */

import type { ActionParamSpec, ProposalAction } from "./actions";
import { encodeAction, findContract, findFunction, formatParamValue } from "./actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row of the preview: a single parameter moving from A to B. */
export interface ParamDiff {
  paramName: string;
  label: string;
  /** Formatted current value, or null when it could not be read. */
  current: string | null;
  /** Formatted proposed value. */
  proposed: string;
  /** Numeric delta, when both sides are numeric. */
  delta: number | null;
  /** Percentage change, when both sides are numeric and the base is non-zero. */
  percentChange: number | null;
  unit: string;
  /** "up" | "down" | "same" | "unknown" — drives the diff colour. */
  direction: "up" | "down" | "same" | "unknown";
}

export interface ActionSimulation {
  actionId: string;
  contractLabel: string;
  functionLabel: string;
  /** One line describing the call, e.g. "Set Put collateral ratio → 120%". */
  summary: string;
  diffs: ParamDiff[];
  /** True when any diff could not be read. */
  partial: boolean;
  /** Errors raised while encoding the action's raw inputs. */
  errors: { paramName: string; message: string }[];
  /** Whether the action needs an explicit extra acknowledgement. */
  dangerous: boolean;
}

/** Reads the current on-chain value for a given contract getter. */
export type ValueReader = (input: {
  contractKey: string;
  readMethod: string;
  contractId: string | null;
}) => Promise<string | null>;

export interface SimulationResult {
  simulations: ActionSimulation[];
  /** True when at least one action still has encoding errors. */
  hasErrors: boolean;
  /** True when at least one action is flagged dangerous. */
  hasDangerous: boolean;
  /** True when the action count is within the governor's per-proposal limit. */
  withinActionLimit: boolean;
}

// ---------------------------------------------------------------------------
// Numeric extraction
// ---------------------------------------------------------------------------

/**
 * Pull a comparable number out of a formatted value.  Basis points and
 * percents have to be de-scaled before the delta is meaningful, so the
 * conversion is driven by the spec rather than guessed from the string.
 */
function numericValue(spec: ActionParamSpec, formatted: string | null): number | null {
  if (formatted === null) return null;
  const cleaned = formatted.replace(/[^0-9.+-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+" || cleaned === ".") return null;

  let n = Number(cleaned);
  if (Number.isNaN(n)) return null;

  switch (spec.display) {
    case "bps":
      // formatParamValue rendered bps as a percent → multiply back for deltas.
      n = n * 100;
      break;
    case "xlm":
      n = n * 1e7;
      break;
    default:
      break;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

export function diffParam(
  spec: ActionParamSpec,
  currentFormatted: string | null,
  proposedFormatted: string
): ParamDiff {
  const current = numericValue(spec, currentFormatted);
  const proposed = numericValue(spec, proposedFormatted);

  let delta: number | null = null;
  let percentChange: number | null = null;
  let direction: ParamDiff["direction"] = "unknown";

  if (current !== null && proposed !== null) {
    delta = proposed - current;
    if (current !== 0) percentChange = ((proposed - current) / Math.abs(current)) * 100;
    if (delta > 0) direction = "up";
    else if (delta < 0) direction = "down";
    else direction = "same";
  }

  return {
    paramName: spec.name,
    label: spec.label,
    current: currentFormatted,
    proposed: proposedFormatted,
    delta,
    percentChange,
    unit: spec.unit ?? "",
    direction,
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface SimulateOptions {
  /** Resolves contract IDs by key; null means the contract isn't deployed. */
  contractIds?: Record<string, string | undefined>;
  /** Reads the current on-chain value. Defaults to "always unknown". */
  reader?: ValueReader;
  /** Governor's max actions per proposal. */
  maxActions?: number;
}

/**
 * Produce the full preview for a draft's actions.  Never throws — a failed
 * read or a malformed action becomes a reported error, not an exception.
 */
export async function simulateActions(
  actions: ProposalAction[],
  options: SimulateOptions = {}
): Promise<SimulationResult> {
  const { contractIds = {}, maxActions = 8 } = options;
  const reader: ValueReader = options.reader ?? (async () => null);

  const simulations = await Promise.all(
    actions.map(async (action): Promise<ActionSimulation> => {
      const contract = findContract(action.contractKey);
      const fn = contract?.functions.find((f) => f.name === action.functionName);

      if (!contract || !fn) {
        return {
          actionId: action.id,
          contractLabel: action.contractKey,
          functionLabel: action.functionName,
          summary: "Unknown action",
          diffs: [],
          partial: true,
          errors: [
            { paramName: "-", message: `Unknown contract or function "${action.functionName}".` },
          ],
          dangerous: false,
        };
      }

      const encoded = encodeAction(action);
      const diffs: ParamDiff[] = [];
      let partial = false;

      for (let i = 0; i < fn.params.length; i++) {
        const spec = fn.params[i];
        const encodedValue = encoded?.args[i];

        // A field that failed validation has no meaningful proposed value.
        const failed = encoded?.errors.find((e) => e.paramName === spec.name);
        if (failed) {
          partial = true;
          continue;
        }

        const proposedFormatted = formatParamValue(spec, encodedValue);

        let currentFormatted: string | null = null;
        if (spec.readMethod) {
          const contractId = contractIds[contract.key] ?? null;
          try {
            const raw = await reader({
              contractKey: contract.key,
              readMethod: spec.readMethod,
              contractId,
            });
            if (raw !== null) {
              // The reader returns the raw on-chain value; format it with the
              // same spec so both sides of the arrow share units.
              currentFormatted = formatParamValue(spec, coerceReadValue(raw));
            } else {
              partial = true;
            }
          } catch {
            partial = true;
          }
        }

        diffs.push(diffParam(spec, currentFormatted, proposedFormatted));
      }

      return {
        actionId: action.id,
        contractLabel: contract.label,
        functionLabel: fn.label,
        summary: `${fn.label} → ${fn.params
          .map((spec, i) => `${spec.label} ${formatParamValue(spec, encoded?.args[i])}`)
          .join(" · ")}`,
        diffs,
        partial,
        errors: (encoded?.errors ?? []).map((e) => ({
          paramName: e.paramName,
          message: describeError(e.error),
        })),
        dangerous: Boolean(fn.dangerous || fn.params.some((p) => p.dangerous)),
      };
    })
  );

  return {
    simulations,
    hasErrors: simulations.some((s) => s.errors.length > 0),
    hasDangerous: simulations.some((s) => s.dangerous),
    withinActionLimit: actions.length <= maxActions,
  };
}

/**
 * Convert a raw string read from the chain into the value type the formatter
 * expects.  Integers become BigInt so i128/u128 magnitudes survive.
 */
function coerceReadValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) {
    try {
      return BigInt(trimmed);
    } catch {
      return raw;
    }
  }
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  return raw;
}

function describeError(error: string): string {
  return error.replace(/_/g, " ");
}

/** Convenience: the label shown on the "current → proposed" arrow. */
export function formatDiffRow(diff: ParamDiff): string {
  const from = diff.current ?? "?";
  return `${diff.label}: ${from} → ${diff.proposed}`;
}
