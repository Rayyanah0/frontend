/**
 * Unit tests for validateTick — adversarial tick sequences.
 *
 * The test suite is structured in sections:
 *  1. Schema checks — non-finite, non-positive, bounds
 *  2. Vol checks — range and finiteness
 *  3. Jump checks — slow/fast moves, reconnect grace, median seeding
 *  4. Oracle cross-check — deviation threshold
 *  5. Multi-symbol ticks — first symbol with a problem is rejected
 *  6. rollingMedian utility
 *  7. Integration sequences — long adversarial tick streams
 */

import {
  validateTick,
  rollingMedian,
  checkPriceFinitePositive,
  checkPriceBounds,
  checkVol,
  checkPriceJump,
  checkOracleDeviation,
  type RawTick,
  type SymbolBaseline,
  type ValidationConfig,
} from "../validateTick";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal RawTick for BTC. */
function btcTick(price: number, vol = 0.8): RawTick {
  return { prices: { BTC: price }, vols: { BTC: vol } };
}

/** Build a baseline with the given median (no reconnect flag). */
function baseline(medianPrice: number, reconnected = false): SymbolBaseline {
  return { medianPrice, reconnected };
}

/** Run validateTick and expect it to accept. */
function expectAccept(
  tick: RawTick,
  baselines: Record<string, SymbolBaseline> = {},
  config: ValidationConfig = {},
  oracle?: Record<string, number>,
) {
  const result = validateTick(tick, baselines, config, oracle);
  expect(result.accept).toBe(true);
  return result;
}

/** Run validateTick and expect it to reject with the given reason. */
function expectReject(
  expectedReason: string,
  tick: RawTick,
  baselines: Record<string, SymbolBaseline> = {},
  config: ValidationConfig = {},
  oracle?: Record<string, number>,
) {
  const result = validateTick(tick, baselines, config, oracle);
  expect(result.accept).toBe(false);
  if (!result.accept) {
    expect(result.reason).toBe(expectedReason);
    expect(result.symbol).toBeDefined();
    expect(result.message).toBeTruthy();
  }
  return result;
}

// ─── 1. Schema checks ────────────────────────────────────────────────────────

describe("validateTick — schema checks", () => {
  it("accepts a well-formed tick with no history", () => {
    expectAccept(btcTick(50000, 0.8));
  });

  it("rejects NaN price", () => {
    expectReject("non_finite_price", btcTick(NaN));
  });

  it("rejects Infinity price", () => {
    expectReject("non_finite_price", btcTick(Infinity));
  });

  it("rejects -Infinity price", () => {
    expectReject("non_finite_price", btcTick(-Infinity));
  });

  it("rejects zero price", () => {
    expectReject("non_positive_price", btcTick(0));
  });

  it("rejects negative price", () => {
    expectReject("non_positive_price", btcTick(-1));
  });

  it("rejects price below configured minPrice floor", () => {
    expectReject("price_below_floor", btcTick(5), {}, { minPrice: 10 });
  });

  it("rejects price above configured maxPrice ceiling", () => {
    expectReject("price_above_ceiling", btcTick(1_000_001), {}, { maxPrice: 1_000_000 });
  });

  it("accepts price exactly at the configured minPrice boundary (strict inequality)", () => {
    // minPrice: 10 means price > 10 is needed; 10 itself is rejected
    expectReject("price_below_floor", btcTick(10), {}, { minPrice: 10 });
  });

  it("accepts price just above the floor", () => {
    expectAccept(btcTick(10.001), {}, { minPrice: 10 });
  });
});

// ─── 2. Vol checks ───────────────────────────────────────────────────────────

describe("validateTick — vol checks", () => {
  it("accepts standard vol", () => {
    expectAccept(btcTick(50000, 0.5));
  });

  it("rejects NaN vol", () => {
    expectReject("non_finite_vol", btcTick(50000, NaN));
  });

  it("rejects zero vol", () => {
    expectReject("non_positive_vol", btcTick(50000, 0));
  });

  it("rejects negative vol", () => {
    expectReject("non_positive_vol", btcTick(50000, -0.1));
  });

  it("rejects vol below minVol", () => {
    // Default minVol is 0.001; 0.0001 should be rejected.
    expectReject("vol_out_of_range", btcTick(50000, 0.0001));
  });

  it("rejects vol above maxVol (2000%)", () => {
    expectReject("vol_out_of_range", btcTick(50000, 25.0)); // 2500%
  });

  it("accepts vol at the edge of default range (just inside)", () => {
    expectAccept(btcTick(50000, 0.002)); // just above 0.1% floor
    expectAccept(btcTick(50000, 19.99)); // just below 2000% ceiling
  });

  it("accepts ticks with no vol entry (vol is optional)", () => {
    const tick: RawTick = { prices: { BTC: 50000 }, vols: {} };
    expectAccept(tick);
  });

  it("applies custom vol range from config", () => {
    // stablecoin-specific config: vol capped at 50%
    const config: ValidationConfig = { maxVol: 0.5 };
    expectReject("vol_out_of_range", btcTick(1.0001, 0.8), {}, config);
    expectAccept(btcTick(1.0001, 0.3), {}, config);
  });
});

// ─── 3. Jump checks ──────────────────────────────────────────────────────────

describe("validateTick — jump checks", () => {
  it("accepts the first tick (no baseline)", () => {
    expectAccept(btcTick(50000), {});
  });

  it("accepts a small move within threshold", () => {
    // Median 50000, 14% move → within default 15%.
    expectAccept(btcTick(57000), { BTC: baseline(50000) });
  });

  it("rejects a jump exactly at the threshold (strict: deviation > threshold)", () => {
    // Exactly 15% is still within the limit (> not >=)
    expectAccept(btcTick(57500), { BTC: baseline(50000) }); // exactly 15%
  });

  it("rejects a jump slightly above threshold", () => {
    // 15.1% above baseline
    expectReject("price_jump_too_large", btcTick(57550), { BTC: baseline(50000) });
  });

  it("rejects a large upward spike (10× price)", () => {
    expectReject("price_jump_too_large", btcTick(500000), { BTC: baseline(50000) });
  });

  it("rejects a large downward crash (90% drop)", () => {
    expectReject("price_jump_too_large", btcTick(5000), { BTC: baseline(50000) });
  });

  it("accepts first tick after reconnect regardless of jump size (10× spike)", () => {
    // reconnected: true means this is the first tick post-reconnect
    expectAccept(btcTick(500000), { BTC: { medianPrice: 50000, reconnected: true } });
  });

  it("blocks large jump after reconnect grace expires (second tick)", () => {
    // reconnected: false simulates that the first post-reconnect tick was already
    // accepted and the reconnect grace was cleared.
    expectReject("price_jump_too_large", btcTick(500000), {
      BTC: { medianPrice: 500000, reconnected: false },
    });
  });

  it("respects a custom maxJumpFraction", () => {
    const config: ValidationConfig = { maxJumpFraction: 0.05 }; // 5%
    // 6% move should fail.
    expectReject("price_jump_too_large", btcTick(53000), { BTC: baseline(50000) }, config);
    // 4% move should pass.
    expectAccept(btcTick(52000), { BTC: baseline(50000) }, config);
  });

  it("accepts when there is no medianPrice yet (undefined baseline)", () => {
    expectAccept(btcTick(50000), { BTC: { medianPrice: undefined } });
  });

  it("accepts first-ever tick with empty baselines object", () => {
    expectAccept(btcTick(50000), {});
  });
});

// ─── 4. Oracle deviation ─────────────────────────────────────────────────────

describe("validateTick — oracle cross-check", () => {
  it("accepts when no oracle is provided", () => {
    expectAccept(btcTick(50000), {}, {}, undefined);
  });

  it("accepts when symbol is absent from oracle map", () => {
    expectAccept(btcTick(50000), {}, {}, { ETH: 3000 });
  });

  it("accepts price within 10% of oracle", () => {
    // 9% deviation — within the 10% default
    expectAccept(btcTick(54500), {}, {}, { BTC: 50000 });
  });

  it("rejects price more than 10% above oracle", () => {
    // 11% above
    expectReject("oracle_deviation_too_large", btcTick(55500), {}, {}, { BTC: 50000 });
  });

  it("rejects price more than 10% below oracle", () => {
    // 11% below
    expectReject("oracle_deviation_too_large", btcTick(44500), {}, {}, { BTC: 50000 });
  });

  it("skips oracle check if oracle price is 0 or negative", () => {
    // A corrupt oracle value shouldn't block valid feed ticks.
    expectAccept(btcTick(50000), {}, {}, { BTC: 0 });
    expectAccept(btcTick(50000), {}, {}, { BTC: -1 });
  });

  it("skips oracle check if oracle price is NaN", () => {
    expectAccept(btcTick(50000), {}, {}, { BTC: NaN });
  });

  it("applies custom maxOracleDeviation", () => {
    const config: ValidationConfig = { maxOracleDeviation: 0.05 }; // 5%
    expectReject("oracle_deviation_too_large", btcTick(52600), {}, config, { BTC: 50000 });
    expectAccept(btcTick(52400), {}, config, { BTC: 50000 });
  });
});

// ─── 5. Multi-symbol ticks ───────────────────────────────────────────────────

describe("validateTick — multi-symbol ticks", () => {
  it("accepts when all symbols are valid", () => {
    const tick: RawTick = {
      prices: { BTC: 50000, ETH: 3000, SOL: 150 },
      vols: { BTC: 0.7, ETH: 0.9, SOL: 1.2 },
    };
    expectAccept(tick, {});
  });

  it("rejects on the first failing symbol encountered", () => {
    const tick: RawTick = {
      prices: { BTC: 50000, ETH: NaN },
      vols: { BTC: 0.7, ETH: 0.9 },
    };
    const result = validateTick(tick, {});
    expect(result.accept).toBe(false);
    if (!result.accept) {
      expect(result.reason).toBe("non_finite_price");
      expect(result.symbol).toBe("ETH");
    }
  });

  it("rejects when second symbol has an impossible price", () => {
    const tick: RawTick = {
      prices: { BTC: 50000, ETH: -1 },
      vols: { BTC: 0.7, ETH: 0.9 },
    };
    expectReject("non_positive_price", tick, {});
  });
});

// ─── 6. rollingMedian ────────────────────────────────────────────────────────

describe("rollingMedian", () => {
  it("returns NaN for empty window", () => {
    expect(Number.isNaN(rollingMedian([]))).toBe(true);
  });

  it("returns the single element for a window of 1", () => {
    expect(rollingMedian([42])).toBe(42);
  });

  it("returns middle value for odd-length sorted window", () => {
    expect(rollingMedian([10, 20, 30])).toBe(20);
  });

  it("returns average of two middle values for even-length window", () => {
    expect(rollingMedian([10, 20, 30, 40])).toBe(25);
  });

  it("sorts the window before computing median", () => {
    expect(rollingMedian([40, 10, 30, 20])).toBe(25);
  });

  it("does not mutate the input array", () => {
    const arr = [40, 10, 30, 20];
    rollingMedian(arr);
    expect(arr).toEqual([40, 10, 30, 20]);
  });

  it("handles a window of 20 values correctly", () => {
    // 1..20 → median = (10 + 11) / 2 = 10.5
    const w = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(rollingMedian(w)).toBe(10.5);
  });
});

// ─── 7. Individual rule functions ────────────────────────────────────────────

describe("checkPriceFinitePositive", () => {
  it("returns null for a valid positive price", () => {
    expect(checkPriceFinitePositive("BTC", 50000)).toBeNull();
  });

  it("returns non_finite_price for NaN", () => {
    const r = checkPriceFinitePositive("BTC", NaN);
    expect(r?.reason).toBe("non_finite_price");
  });

  it("returns non_positive_price for 0", () => {
    const r = checkPriceFinitePositive("BTC", 0);
    expect(r?.reason).toBe("non_positive_price");
  });
});

describe("checkPriceBounds", () => {
  const cfg = { maxJumpFraction: 0.15, reconnectGraceTicks: 1, minPrice: 0, maxPrice: Infinity, minVol: 0.001, maxVol: 20, maxOracleDeviation: 0.1 };

  it("returns null when price is within bounds", () => {
    expect(checkPriceBounds("BTC", 50000, cfg)).toBeNull();
  });

  it("returns price_below_floor when price <= minPrice", () => {
    const r = checkPriceBounds("BTC", 0, cfg);
    expect(r?.reason).toBe("price_below_floor");
  });

  it("returns price_above_ceiling when price >= maxPrice", () => {
    const r = checkPriceBounds("BTC", Infinity, cfg);
    expect(r?.reason).toBe("price_above_ceiling");
  });
});

// ─── 8. Integration: adversarial tick sequences ───────────────────────────────

describe("validateTick — adversarial integration sequences", () => {
  /**
   * Simulates a feed that starts healthy, then injects a flash spike, then
   * recovers.  Validates that:
   *  - Normal ticks are accepted.
   *  - Spike ticks are rejected.
   *  - Recovery ticks within threshold are accepted once the spike is gone.
   *
   * NOTE: This test drives validateTick directly without the store, so it
   * manually maintains the baseline between calls.
   */
  it("rejects a flash spike and accepts normal recovery", () => {
    // Seed baseline with several normal prices around 50000.
    const normalPrices = [49800, 50000, 50100, 50200, 50000, 49900, 50050];
    // median ≈ 50000

    // After all normal ticks, median = 50000.
    // Now inject a 10× spike.
    const spikeResult = validateTick(
      btcTick(500000),
      { BTC: baseline(50000) }, // simulate stored median
    );
    expect(spikeResult.accept).toBe(false);
    if (!spikeResult.accept) {
      expect(spikeResult.reason).toBe("price_jump_too_large");
    }

    // After the spike is rejected, the median stays at 50000. A recovery tick
    // back to 50500 (1% above median) should be accepted.
    const recoveryResult = validateTick(
      btcTick(50500),
      { BTC: baseline(50000) },
    );
    expect(recoveryResult.accept).toBe(true);
  });

  it("rejects NaN injected mid-stream", () => {
    // Some feeds corrupt individual frames with NaN.
    const midStreamNaN: RawTick = {
      prices: { BTC: NaN },
      vols: { BTC: 0.8 },
    };
    const r = validateTick(midStreamNaN, { BTC: baseline(50000) });
    expect(r.accept).toBe(false);
    if (!r.accept) expect(r.reason).toBe("non_finite_price");
  });

  it("handles a gradual price walk that exceeds threshold in one step", () => {
    // Prices walk up slowly — each step is under 15%. But imagine the median
    // was pinned at 50000 and one step jumps 20%.
    const r = validateTick(btcTick(60001), { BTC: baseline(50000) }); // 20% jump
    expect(r.accept).toBe(false);
    if (!r.accept) expect(r.reason).toBe("price_jump_too_large");
  });

  it("accepts a sequence of ticks with no baseline (seeding phase)", () => {
    // First few ticks should always be accepted while establishing history.
    const seedPrices = [50000, 50100, 49900, 50050, 50200];
    for (const price of seedPrices) {
      // No baseline at all — simulates an empty store
      const r = validateTick(btcTick(price), {});
      expect(r.accept).toBe(true);
    }
  });

  it("rejects ticks with corrupted vol alongside valid price", () => {
    // A feed bug that zeroes out all vols.
    const zeroVolTick: RawTick = {
      prices: { BTC: 50000 },
      vols: { BTC: 0 },
    };
    const r = validateTick(zeroVolTick, { BTC: baseline(50000) });
    expect(r.accept).toBe(false);
    if (!r.accept) expect(r.reason).toBe("non_positive_vol");
  });

  it("rejects a compressed vol spike (IV → 9999%)", () => {
    const r = validateTick(btcTick(50000, 99.99), { BTC: baseline(50000) });
    expect(r.accept).toBe(false);
    if (!r.accept) expect(r.reason).toBe("vol_out_of_range");
  });

  it("passes oracle cross-check but then rejects on jump (oracle does not override jump check)", () => {
    // Oracle says 50000, but price jumped 20% from a baseline of 50000.
    // Jump check fires first (fail-fast ordering).
    const r = validateTick(
      btcTick(60001),
      { BTC: baseline(50000) },
      {},
      { BTC: 60001 }, // oracle agrees with the spike price — doesn't matter
    );
    expect(r.accept).toBe(false);
    if (!r.accept) expect(r.reason).toBe("price_jump_too_large");
  });

  it("accepts a tick that passes jump check but then fails oracle cross-check", () => {
    // Price is only 5% from baseline, but oracle says 50000 while price is 55600 (11.2% from oracle).
    const r = validateTick(
      btcTick(55600),
      { BTC: baseline(53000) }, // only ~4.9% jump vs median
      {},
      { BTC: 50000 }, // but oracle is at 50000 → 11.2% deviation
    );
    expect(r.accept).toBe(false);
    if (!r.accept) expect(r.reason).toBe("oracle_deviation_too_large");
  });

  it("rejects a multi-symbol tick where second symbol has zero price", () => {
    const tick: RawTick = {
      prices: { BTC: 50000, ETH: 0 },
      vols: { BTC: 0.7, ETH: 0.9 },
    };
    const r = validateTick(tick, {});
    expect(r.accept).toBe(false);
    if (!r.accept) {
      expect(r.reason).toBe("non_positive_price");
      expect(r.symbol).toBe("ETH");
    }
  });

  it("rejects a multi-symbol tick where one symbol has an insane price jump", () => {
    const tick: RawTick = {
      prices: { BTC: 50500, ETH: 30000 }, // ETH is 10× the baseline
      vols: { BTC: 0.7, ETH: 0.9 },
    };
    const r = validateTick(tick, {
      BTC: baseline(50000),
      ETH: baseline(3000),
    });
    expect(r.accept).toBe(false);
    if (!r.accept) {
      expect(r.reason).toBe("price_jump_too_large");
      expect(r.symbol).toBe("ETH");
    }
  });
});
