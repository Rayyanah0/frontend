"use client";

import { useSyncExternalStore } from "react";
import { dismissToast, getToasts, subscribeToasts, type ToastVariant } from "../../lib/toast";

const EMPTY: ReturnType<typeof getToasts> = [];
const COLORS: Record<ToastVariant, string> = {
  success: "var(--call)",
  info: "var(--brand)",
  warning: "var(--atm)",
  error: "var(--put)",
};

/**
 * Accessible live region for the toast queue. Errors use role="alert"
 * (assertive), everything else role="status" (polite). Never takes focus.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY);
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      style={{
        position: "fixed", right: 16, bottom: 16, zIndex: 1000, display: "flex",
        flexDirection: "column", gap: 8, maxWidth: 360, pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.variant === "error" ? "alert" : "status"}
          className="zn-toast"
          style={{
            pointerEvents: "auto", background: "var(--bg-elevated)", color: "var(--text-hi)",
            border: "1px solid var(--border-default)", borderLeft: `3px solid ${COLORS[t.variant]}`,
            padding: "8px 12px", fontSize: 12, display: "flex", gap: 10, alignItems: "center",
          }}
        >
          <span style={{ flex: 1 }}>
            {t.message}
            {t.count > 1 && <span style={{ color: "var(--text-lo)" }}> ×{t.count}</span>}
          </span>
          {t.action && (
            <button
              onClick={() => { t.action?.onClick(); dismissToast(t.id); }}
              style={{ background: "transparent", color: "var(--brand)", border: "1px solid var(--brand)", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            style={{ background: "transparent", color: "var(--text-mid)", border: "none", cursor: "pointer", fontSize: 14 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
