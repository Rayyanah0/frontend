import { useEffect, useMemo, useState } from "react";
import {
  aggregateTicks,
  type Candle,
  type CandleInterval,
  type Tick,
  updateCandleWithTick,
} from "./candles";
import { getCandles } from "./api/market";

/**
 * Candle history for a symbol. Tries GET /api/v1/candles; on failure seeds
 * from the live WebSocket/tick buffer and labels the chart "limited history".
 */
export function useCandleHistory(
  sym: string,
  spot: number,
  interval: CandleInterval
): { candles: Candle[]; limitedHistory: boolean; loading: boolean } {
  const [apiCandles, setApiCandles] = useState<Candle[] | null>(null);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setApiCandles(null);
    setTicks([]);
    getCandles(sym, interval)
      .then(rows => {
        if (cancelled) return;
        setApiCandles(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setApiCandles(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sym, interval]);

  useEffect(() => {
    setTicks(prev => [...prev, { t: Date.now(), price: spot }].slice(-2000));
  }, [spot]);

  useEffect(() => {
    setTicks([]);
  }, [sym]);

  const candles = useMemo(() => {
    if (apiCandles && apiCandles.length > 0) {
      return updateCandleWithTick(apiCandles, { t: Date.now(), price: spot }, interval);
    }
    return aggregateTicks(ticks, interval);
  }, [apiCandles, ticks, interval, spot]);

  return {
    candles,
    limitedHistory: !apiCandles || apiCandles.length === 0,
    loading,
  };
}
