// Framework-agnostic toast queue. Non-React code (stores, API layer) can
// call `toast.*`; React subscribes via `subscribeToasts`/`getToasts`
// (see src/components/toast/Toaster.tsx).
import { classifyError, type ClassifiedError } from "./errors";

export type ToastVariant = "success" | "info" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  action?: ToastAction;
  count: number;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Override auto-dismiss (ms). Errors/warnings persist by default; 0 = never. */
  durationMs?: number;
}

const DEDUPE_WINDOW_MS = 5000;
const SUCCESS_MS = 4000;
const MAX_VISIBLE = 5;

let nextId = 1;
let toasts: Toast[] = [];
const lastSeen = new Map<string, { id: number; at: number }>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export const subscribeToasts = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const getToasts = () => toasts;

export function dismissToast(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}

export function pushToast(variant: ToastVariant, message: string, opts: ToastOptions = {}): number {
  const key = `${variant}:${message}`;
  const now = Date.now();
  const prev = lastSeen.get(key);
  // Identical toast within 5s: bump its counter instead of stacking a copy.
  if (prev && now - prev.at < DEDUPE_WINDOW_MS && toasts.some((t) => t.id === prev.id)) {
    toasts = toasts.map((t) => (t.id === prev.id ? { ...t, count: t.count + 1 } : t));
    lastSeen.set(key, { id: prev.id, at: now });
    emit();
    return prev.id;
  }
  const id = nextId++;
  lastSeen.set(key, { id, at: now });
  toasts = [...toasts, { id, variant, message, action: opts.action, count: 1 }].slice(-MAX_VISIBLE);
  const duration = opts.durationMs ?? (variant === "success" || variant === "info" ? SUCCESS_MS : 0);
  if (duration > 0) timers.set(id, setTimeout(() => dismissToast(id), duration));
  emit();
  return id;
}

export const toast = {
  success: (m: string, o?: ToastOptions) => pushToast("success", m, o),
  info: (m: string, o?: ToastOptions) => pushToast("info", m, o),
  warning: (m: string, o?: ToastOptions) => pushToast("warning", m, o),
  error: (m: string, o?: ToastOptions) => pushToast("error", m, o),
  /** Classify any thrown value and surface it. `retry` wires the "Retry" button. */
  fromError(err: unknown, opts: { retry?: () => void; context?: string; onSignIn?: () => void } = {}): ClassifiedError {
    const c = classifyError(err);
    const message = opts.context ? `${opts.context}: ${c.message}` : c.message;
    let action: ToastAction | undefined;
    if (c.action === "retry" && opts.retry) action = { label: "Retry", onClick: opts.retry };
    if (c.action === "sign_in" && opts.onSignIn) action = { label: "Sign in", onClick: opts.onSignIn };
    pushToast("error", message, { action });
    return c;
  },
};
