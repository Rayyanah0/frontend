export type PriceSource = "live" | "fallback-model" | "seed";

/** A price plus where it came from and when. Propagate instead of bare numbers. */
export interface Priced<T = number> {
  value: T;
  source: PriceSource;
  /** Epoch ms of the last live tick, or null for seed/model values. */
  asOf: number | null;
}
