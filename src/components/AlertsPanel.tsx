"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAlert, deleteAlert, getAlerts } from "../lib/api/alerts";
import { ApiError } from "../lib/api/client";
import { queryKeys } from "../lib/api/queryKeys";
import type { AlertCondition } from "../lib/api/types";
import { useWalletStore } from "../lib/store/wallet";
import { fmtSpot } from "../lib/pricing";
import { formatForInput, priceSchema, useValidatedNumberInput } from "../lib/validation";
import { useIdempotencyKey } from "../lib/hooks/useIdempotencyKey";

// Module-level so the hook's memoised safeParse isn't recomputed every render.
const thresholdSchema = priceSchema({ gt: 0, max: 1_000_000_000, maxDecimals: 7 });

/** Price alerts for the current underlying. Threshold input is schema-validated. */
export function AlertsPanel({ sym, spot }: { sym: string; spot: number }) {
  const token = useWalletStore((s) => s.token);
  const qc = useQueryClient();
  const [condition, setCondition] = useState<AlertCondition>("above");
  const threshold = useValidatedNumberInput(thresholdSchema);
  const { keyFor, complete } = useIdempotencyKey();

  const alerts = useQuery({
    queryKey: queryKeys.alerts(token),
    queryFn: ({ signal }) => getAlerts(token!, { signal }),
    enabled: !!token,
  });

  const create = useMutation({
    mutationFn: (targetPrice: number) => {
      const intent = { underlying: sym, condition, targetPrice };
      return createAlert(intent, token!, { idempotencyKey: keyFor(intent) });
    },
    onSuccess: () => {
      complete();
      threshold.setRaw("");
      qc.invalidateQueries({ queryKey: queryKeys.alerts(token) });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAlert(id, token!),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.alerts(token) }),
  });

  // A threshold on the wrong side of spot would fire immediately — say so.
  const value = threshold.value;
  const wrongSide = value !== null && spot > 0 && (condition === "above" ? value <= spot : value >= spot);
  const canSubmit = !!token && threshold.valid && !create.isPending;
  const submitError = create.error instanceof ApiError ? create.error.message : create.error ? "Failed to create alert" : null;
  const mine = (alerts.data ?? []).filter((a) => a.underlying === sym);

  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)", marginBottom: 8 }}>
        Price Alerts
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && value !== null) create.mutate(value);
        }}
        noValidate
      >
        <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
          <select
            aria-label="Alert condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value === "below" ? "below" : "above")}
            style={{ fontSize: 11, background: "var(--bg-overlay)", color: "var(--text-hi)", border: "1px solid var(--border-default)" }}
          >
            <option value="above">Above</option>
            <option value="below">Below</option>
          </select>
          <input
            {...threshold.inputProps}
            aria-label={`${sym} alert price`}
            placeholder={spot > 0 ? formatForInput(spot) : "Price"}
            style={{
              flex: 1, minWidth: 0, fontSize: 11, fontFamily: "var(--font-mono)", padding: "4px 6px",
              background: "var(--bg-overlay)", color: threshold.error ? "var(--put)" : "var(--text-hi)",
              border: `1px solid ${threshold.error ? "var(--put)" : "var(--border-default)"}`,
            }}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            style={{ fontSize: 11, padding: "4px 8px", border: "none", background: "var(--brand)", color: "var(--bg)", opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}
          >
            {create.isPending ? "…" : "Add"}
          </button>
        </div>
        {threshold.error && (
          <div id={threshold.errorId} role="alert" style={{ fontSize: 10, color: "var(--put)", marginBottom: 4 }}>
            {threshold.error}
          </div>
        )}
        {!threshold.error && wrongSide && (
          <div style={{ fontSize: 10, color: "var(--atm)", marginBottom: 4 }}>
            Spot is already {condition === "above" ? "above" : "below"} this price ({fmtSpot(spot)}) — it will trigger immediately.
          </div>
        )}
        {!token && <div style={{ fontSize: 10, color: "var(--text-lo)" }}>Connect your wallet to set alerts.</div>}
        {submitError && <div role="alert" style={{ fontSize: 10, color: "var(--put)" }}>{submitError}</div>}
      </form>

      {mine.map((a) => (
        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
          <span className="num" style={{ fontSize: 11, color: a.triggered ? "var(--text-lo)" : "var(--text-hi)" }}>
            {a.condition === "above" ? "▲" : "▼"} {fmtSpot(a.target_price)}{a.triggered ? " · triggered" : ""}
          </span>
          <button
            type="button"
            aria-label="Delete alert"
            onClick={() => remove.mutate(a.id)}
            disabled={remove.isPending}
            style={{ fontSize: 12, background: "none", border: "none", color: "var(--text-lo)", cursor: "pointer" }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
