/**
 * useRfq — Issue #65.
 *
 * React hook for the RFQ workflow. Gated by the NEXT_PUBLIC_ENABLE_RFQ_MOCK
 * feature flag. Returns null when the flag is off.
 */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RfqRecord, CreateRfqParams, RfqAdapter } from "./types";
import { MockRfqAdapter } from "./mockAdapter";

const RFQ_ENABLED =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_ENABLE_RFQ_MOCK === "true";

interface UseRfqResult {
  enabled: boolean;
  activeRfq: RfqRecord | null;
  history: RfqRecord[];
  loading: boolean;
  error: string | null;
  submitRfq: (params: CreateRfqParams) => Promise<void>;
  acceptQuote: (quoteId: string) => Promise<void>;
  cancelRfq: () => Promise<void>;
  clearActive: () => void;
}

export function useRfq(): UseRfqResult {
  const adapterRef = useRef<RfqAdapter | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const [activeRfq, setActiveRfq] = useState<RfqRecord | null>(null);
  const [history, setHistory] = useState<RfqRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize adapter
  useEffect(() => {
    if (!RFQ_ENABLED) return;
    const adapter = new MockRfqAdapter();
    adapterRef.current = adapter;
    adapter.listRfqs().then(setHistory).catch(() => {});

    return () => {
      unsubRef.current?.();
      (adapter as MockRfqAdapter).dispose();
    };
  }, []);

  const subscribeToActive = useCallback((rfq: RfqRecord) => {
    unsubRef.current?.();
    if (!adapterRef.current) return;
    unsubRef.current = adapterRef.current.subscribeToQuotes(rfq.id, (updated) => {
      setActiveRfq(updated);
      // Mirror terminal states into history
      if (["accepted", "expired", "cancelled"].includes(updated.status)) {
        setHistory(prev => {
          const idx = prev.findIndex(r => r.id === updated.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = updated;
            return next;
          }
          return [updated, ...prev];
        });
      }
    });
  }, []);

  const submitRfq = useCallback(async (params: CreateRfqParams) => {
    if (!adapterRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const rfq = await adapterRef.current.createRfq(params);
      setActiveRfq(rfq);
      setHistory(prev => [rfq, ...prev]);
      subscribeToActive(rfq);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit RFQ");
    } finally {
      setLoading(false);
    }
  }, [subscribeToActive]);

  const acceptQuote = useCallback(async (quoteId: string) => {
    if (!adapterRef.current || !activeRfq) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await adapterRef.current.acceptQuote({ rfqId: activeRfq.id, quoteId });
      setActiveRfq(updated);
      setHistory(prev => {
        const idx = prev.findIndex(r => r.id === updated.id);
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
        return [updated, ...prev];
      });
      unsubRef.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept quote");
    } finally {
      setLoading(false);
    }
  }, [activeRfq]);

  const cancelRfq = useCallback(async () => {
    if (!adapterRef.current || !activeRfq) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await adapterRef.current.cancelRfq(activeRfq.id);
      setActiveRfq(updated);
      setHistory(prev => {
        const idx = prev.findIndex(r => r.id === updated.id);
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
        return [updated, ...prev];
      });
      unsubRef.current?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel RFQ");
    } finally {
      setLoading(false);
    }
  }, [activeRfq]);

  const clearActive = useCallback(() => {
    unsubRef.current?.();
    setActiveRfq(null);
    setError(null);
  }, []);

  return {
    enabled: RFQ_ENABLED,
    activeRfq,
    history,
    loading,
    error,
    submitRfq,
    acceptQuote,
    cancelRfq,
    clearActive,
  };
}
