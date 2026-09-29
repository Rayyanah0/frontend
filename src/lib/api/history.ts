import { apiGet } from "./client";
import type { HistoryResponse } from "./types";
import { HistoryResponseSchema } from "./schemas";

export function getHistory(token: string): Promise<HistoryResponse> {
  return apiGet("/api/v1/history", token, HistoryResponseSchema);
}
