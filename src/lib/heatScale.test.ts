import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSequentialScale,
  buildDivergingScale,
  buildChainHeatScales,
  contrastRatio,
  paletteMeetsContrast,
  SEQUENTIAL_RGB,
  DIVERGING_RGB,
  pickFg,
} from "./heatScale";

describe("heatScale", () => {
  it("maps endpoints of a sequential scale to 0 and 1", () => {
    const s = buildSequentialScale([0.1, 0.5, 0.9]);
    assert.ok(Math.abs(s.t(0.1) - 0) < 1e-9);
    assert.ok(Math.abs(s.t(0.9) - 1) < 1e-9);
    assert.ok(Math.abs(s.t(0.5) - 0.5) < 1e-9);
  });

  it("handles zero-range (identical values) at mid", () => {
    const s = buildSequentialScale([0.42, 0.42, 0.42]);
    assert.equal(s.t(0.42), 0.5);
    assert.equal(s.min, 0.42);
    assert.equal(s.max, 0.42);
  });

  it("builds a symmetric diverging scale around zero", () => {
    const s = buildDivergingScale([-0.2, 0, 0.1]);
    assert.ok(Math.abs(s.t(0) - 0.5) < 1e-9);
    assert.ok(Math.abs(s.min - -0.2) < 1e-9);
    assert.ok(Math.abs(s.max - 0.2) < 1e-9);
  });

  it("precomputes chain scales from visible rows", () => {
    const scales = buildChainHeatScales([
      {
        callIv: 0.5, putIv: 0.7, callDelta: 0.4, putDelta: -0.3,
        callTheta: -0.01, putTheta: -0.02,
        callVolume: 10, putVolume: null, callOi: 100, putOi: null,
      },
    ]);
    assert.equal(scales.volumeMax, 10);
    assert.equal(scales.oiMax, 100);
    assert.ok(Math.abs(scales.iv.min - 0.5) < 1e-9);
    assert.ok(Math.abs(scales.iv.max - 0.7) < 1e-9);
  });

  it("palette meets WCAG AA 4.5:1 for chosen text on every stop", () => {
    assert.equal(paletteMeetsContrast(4.5), true);
    for (const stop of [...SEQUENTIAL_RGB, ...DIVERGING_RGB]) {
      const fg = pickFg(stop as [number, number, number]);
      const fgRgb: [number, number, number] =
        fg === "var(--text-hi)" ? [243, 238, 227] : [20, 19, 15];
      assert.ok(contrastRatio(stop as [number, number, number], fgRgb) >= 4.5);
    }
  });
});
