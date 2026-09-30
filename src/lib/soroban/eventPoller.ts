// Cursor-based Soroban event poller using RPC getEvents.
// Filters by contract ID and optionally by account address.
// Persists cursor in localStorage so polling resumes after page reload.
// Resilient to RPC retention limits: re-syncs from the latest ledger if cursor is too old.

import type { RawSorobanEvent } from './events';

const CURSOR_KEY = 'zenith_event_cursor';
const DEFAULT_POLL_INTERVAL_MS = 6000; // ~1 Soroban ledger close
const MAX_EVENTS_PER_PAGE = 100;

export type EventPollerStatus = 'idle' | 'polling' | 'error' | 'stopped';

export interface EventPollerConfig {
  rpcUrl: string;
  contractId: string;
  /** Stellar account address to filter events by (topic[1]) */
  accountAddress?: string | null;
  pollIntervalMs?: number;
  onEvents: (events: RawSorobanEvent[]) => void;
  onStatusChange?: (status: EventPollerStatus) => void;
  onError?: (err: Error) => void;
}

function loadCursor(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CURSOR_KEY);
}

function saveCursor(cursor: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CURSOR_KEY, cursor);
}

function clearCursor(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CURSOR_KEY);
}

interface GetEventsParams {
  rpcUrl: string;
  contractId: string;
  cursor: string | null;
  accountAddress?: string | null;
  limit?: number;
}

interface GetEventsResponse {
  result?: {
    events: RawSorobanEvent[];
    latestLedger: string;
  };
  error?: { code: number; message: string; data?: string };
}

async function getEvents(params: GetEventsParams): Promise<{ events: RawSorobanEvent[]; latestLedger: string }> {
  const filters: Record<string, unknown>[] = [
    {
      type: 'contract',
      contractIds: [params.contractId],
      ...(params.accountAddress
        ? { topics: [['*', params.accountAddress]] }
        : {}),
    },
  ];

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getEvents',
    params: {
      startLedger: params.cursor ? undefined : 0,
      cursor: params.cursor ?? undefined,
      filters,
      limit: params.limit ?? MAX_EVENTS_PER_PAGE,
    },
  };

  const res = await fetch(params.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`RPC request failed: ${res.status} ${res.statusText}`);
  const json: GetEventsResponse = await res.json();

  if (json.error) {
    // Check for cursor-too-old / retention limit exceeded
    if (json.error.data?.includes('cursor') || json.error.code === -32600) {
      throw new CursorTooOldError(json.error.message);
    }
    throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  }

  return {
    events: json.result?.events ?? [],
    latestLedger: json.result?.latestLedger ?? '0',
  };
}

export class CursorTooOldError extends Error {
  constructor(message: string) { super(message); this.name = 'CursorTooOldError'; }
}

/**
 * Start polling for Soroban events. Returns a stop function.
 * Re-syncs from the latest ledger if the persisted cursor is too old.
 */
export function startEventPoller(config: EventPollerConfig): () => void {
  const interval = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cursor = loadCursor();

  config.onStatusChange?.('polling');

  const poll = async () => {
    if (stopped) return;
    try {
      const { events, latestLedger } = await getEvents({
        rpcUrl: config.rpcUrl,
        contractId: config.contractId,
        cursor,
        accountAddress: config.accountAddress,
      });

      if (events.length > 0) {
        // Advance cursor to last event's paging token
        const lastToken = events[events.length - 1].pagingToken;
        cursor = lastToken;
        saveCursor(lastToken);
        config.onEvents(events);
      } else {
        // No new events; update cursor to latest ledger to keep it fresh
        if (!cursor) {
          cursor = `${latestLedger}-0`;
          saveCursor(cursor);
        }
      }
      config.onStatusChange?.('polling');
    } catch (err) {
      if (err instanceof CursorTooOldError) {
        // RPC retention limit exceeded — reset cursor and resync
        console.warn('[EventPoller] Cursor too old, resyncing from current ledger.', err.message);
        clearCursor();
        cursor = null;
        config.onError?.(err);
      } else {
        config.onStatusChange?.('error');
        config.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
    if (!stopped) timer = setTimeout(poll, interval);
  };

  // Start immediately
  void poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    config.onStatusChange?.('stopped');
  };
}
