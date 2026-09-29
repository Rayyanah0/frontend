import { ApiError } from "./api/client";

export type ErrorKind =
  | "network"
  | "auth"
  | "validation"
  | "insufficient_funds"
  | "rate_limited"
  | "server"
  | "wallet_rejected"
  | "contract"
  | "unknown";

export type ErrorAction = "retry" | "sign_in" | "fix_input" | "add_funds" | "wait" | "none";

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  action: ErrorAction;
  /** Original message, for logs / details. */
  detail?: string;
}

const MESSAGES: Record<ErrorKind, { message: string; action: ErrorAction }> = {
  network: { message: "Can't reach the Zenith backend. Check your connection and try again.", action: "retry" },
  auth: { message: "You're not signed in. Sign in with your wallet to continue.", action: "sign_in" },
  validation: { message: "That request wasn't valid. Check your inputs and try again.", action: "fix_input" },
  insufficient_funds: { message: "Insufficient balance or collateral for this action.", action: "add_funds" },
  rate_limited: { message: "Too many requests. Wait a moment and try again.", action: "wait" },
  server: { message: "The Zenith backend hit an error. Try again shortly.", action: "retry" },
  wallet_rejected: { message: "The request was rejected in your wallet.", action: "retry" },
  contract: { message: "The on-chain contract rejected this transaction.", action: "none" },
  unknown: { message: "Something went wrong.", action: "retry" },
};

function build(kind: ErrorKind, detail?: string): ClassifiedError {
  return { kind, ...MESSAGES[kind], detail };
}

/** Maps any thrown value (ApiError, fetch TypeError, Freighter, contract) to a taxonomy entry. */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof ApiError) {
    const msg = err.message;
    if (/insufficient/i.test(msg)) return build("insufficient_funds", msg);
    if (err.status === 401 || err.status === 403) return build("auth", msg);
    if (err.status === 429) return build("rate_limited", msg);
    if (err.status === 400 || err.status === 404 || err.status === 409 || err.status === 422) {
      // Prefer the backend's own explanation for validation failures.
      return { ...build("validation", msg), message: msg || MESSAGES.validation.message };
    }
    if (err.status >= 500) return build("server", msg);
    return build("unknown", msg);
  }
  // fetch() rejects with a TypeError on DNS/connection failure/CORS.
  if (err instanceof TypeError) return build("network", err.message);

  const raw = typeof err === "string" ? err : err instanceof Error ? err.message : (err as { message?: string })?.message;
  const msg = typeof raw === "string" ? raw : "";
  if (/user (declined|rejected|denied)|declined access|rejected|denied|cancel/i.test(msg)) return build("wallet_rejected", msg);
  if (/insufficient/i.test(msg)) return build("insufficient_funds", msg);
  if (/contract|simulation failed|HostError|soroban/i.test(msg)) return build("contract", msg);
  if (/failed to fetch|networkerror|network request failed/i.test(msg)) return build("network", msg);
  return build("unknown", msg || undefined);
}
