/**
 * useQuantWorker — Issue #64.
 *
 * Offloads Greek profile sweeps to a Web Worker to keep the main thread
 * responsive. Falls back to running synchronously on the main thread if
 * Worker is unavailable (SSR, old browsers).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Position } from "./api/types";
import {
  computeGreekProfileResult,
  type GreekKey,
  type GreekProfileResult,
  type WorkerRequest,
  type WorkerResponse,
} from "./quantWorker";

interface UseQuantWorkerResult {
  result: GreekProfileResult | null;
  loading: boolean;
  error: string | null;
  compute: (
    underlying: string,
    positions: Position[],
    currentSpot: number,
    baseVol: number,
    greek: GreekKey
  ) => void;
}

export function useQuantWorker(): UseQuantWorkerResult {
  const workerRef = useRef<Worker | null>(null);
  const [result, setResult] = useState<GreekProfileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Spawn worker once on mount, kill on unmount.
  useEffect(() => {
    if (typeof window === "undefined" || !("Worker" in window)) return;
    try {
      const worker = new Worker(new URL("./quant.worker.ts", import.meta.url));
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        setLoading(false);
        if (e.data.type === "PROFILES_RESULT") {
          setResult(e.data.payload);
          setError(null);
        } else if (e.data.type === "ERROR") {
          setError(e.data.error);
        }
      };

      worker.onerror = (err) => {
        setLoading(false);
        setError(err.message ?? "Worker error");
      };

      return () => {
        worker.terminate();
        workerRef.current = null;
      };
    } catch {
      // Worker creation failed — compute falls back to sync path.
    }
  }, []);

  const compute = useCallback(
    (
      underlying: string,
      positions: Position[],
      currentSpot: number,
      baseVol: number,
      greek: GreekKey
    ) => {
      setLoading(true);
      setError(null);

      if (workerRef.current) {
        const msg: WorkerRequest = {
          type: "COMPUTE_PROFILES",
          payload: { underlying, positions, currentSpot, baseVol, greek },
        };
        workerRef.current.postMessage(msg);
      } else {
        // Synchronous fallback (SSR, Worker unavailable)
        try {
          const r = computeGreekProfileResult(underlying, positions, currentSpot, baseVol, greek);
          setResult(r);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setLoading(false);
        }
      }
    },
    []
  );

  return { result, loading, error, compute };
}
