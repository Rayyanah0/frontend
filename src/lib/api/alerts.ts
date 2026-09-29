import { apiDelete, apiGet, apiPost } from "./client";
import type { Alert, AlertCondition } from "./types";
import { AlertListSchema, AlertSchema } from "./schemas";

export function getAlerts(token: string): Promise<Alert[]> {
  return apiGet("/api/v1/alerts", token, AlertListSchema);
}

export function createAlert(
  params: { underlying: string; condition: AlertCondition; targetPrice: number },
  token: string
): Promise<Alert> {
  return apiPost(
    "/api/v1/alerts",
    { underlying: params.underlying, condition: params.condition, target_price: params.targetPrice },
    token,
    AlertSchema
  );
}

export function deleteAlert(id: string, token: string): Promise<void> {
  return apiDelete(`/api/v1/alerts/${id}`, token);
}
