import type { z } from "zod";

/** Response failed runtime validation. `issues` carry the exact field paths. */
export class ContractError extends Error {
  path: string;
  issues: { path: string; message: string }[];
  constructor(endpoint: string, issues: z.ZodIssue[]) {
    const mapped = issues.map(i => ({ path: i.path.join(".") || "(root)", message: i.message }));
    super(
      `Contract violation on ${endpoint}: ` +
        mapped.slice(0, 5).map(i => `${i.path}: ${i.message}`).join("; ") +
        (mapped.length > 5 ? ` (+${mapped.length - 5} more)` : "")
    );
    this.name = "ContractError";
    this.path = endpoint;
    this.issues = mapped;
  }
}

type Listener = (e: ContractError) => void;
const listeners = new Set<Listener>();
export const onContractError = (l: Listener) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/**
 * Dev: fan out to the visible overlay. Prod: report to monitoring (POST to
 * NEXT_PUBLIC_MONITOR_URL if configured, else console) — the error is still
 * thrown to the caller as a query error, so the page degrades rather than
 * rendering NaN, and never crashes as a whole.
 */
export function reportContractError(e: ContractError) {
  console.error(e.message, e.issues);
  listeners.forEach(l => l(e));
  const url = process.env.NEXT_PUBLIC_MONITOR_URL;
  if (process.env.NODE_ENV === "production" && url && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(url, JSON.stringify({ type: "contract_error", endpoint: e.path, issues: e.issues }));
  }
}
