import { apiDelete, apiGet, apiPost } from "./client";
import type { WatchlistItem } from "./types";
import { WatchlistSchema } from "./schemas";

export function getWatchlist(token: string): Promise<WatchlistItem[]> {
  return apiGet("/api/v1/watchlist", token, WatchlistSchema);
}

export function addToWatchlist(underlying: string, token: string): Promise<void> {
  return apiPost("/api/v1/watchlist", { underlying }, token);
}

export function removeFromWatchlist(underlying: string, token: string): Promise<void> {
  return apiDelete(`/api/v1/watchlist/${underlying}`, token);
}
