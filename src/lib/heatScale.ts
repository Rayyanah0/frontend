// Colorblind-safe heat scales for the options chain (ColorBrewer-inspired).
// Sequential for magnitude (IV, |Δ|); diverging for signed Θ.
// Text stays the primary channel — color is never the only encoding.

export type ScaleKind = "sequential" | "diverging";

export interface HeatScale {
  kind: ScaleKind;
  min: number;
  max: number;
  mid: number;
  /** Normalized t in [0,1] for a value; 0.5 when range is zero. */
  t(value: number): number;
  /** CSS background using theme CSS variables. */
  bg(value: number): string;
  /** Text color with ≥4.5:1 contrast against the heat fill. */
  fg(value: number): string;
}

/** ColorBrewer YlOrBr-like sequential stops (sRGB), dark→light for dark UI. */
export const SEQUENTIAL_RGB: readonly [number, number, number][] = [
  [54, 42, 20],
  [89, 62, 24],
  [140, 98, 36],
  [181, 150, 101],
  [232, 214, 168],
];

/** ColorBrewer RdBu-like diverging (put→neutral→call), colorblind-safe. */
export const DIVERGING_RGB: readonly [number, number, number][] = [
  [103, 0, 31],
  [178, 24, 43],
  [214, 96, 77],
  [244, 165, 130],
  [247, 247, 247],
  [146, 197, 222],
  [67, 147, 195],
  [33, 102, 172],
  [5, 48, 97],
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function sampleStops(stops: readonly [number, number, number][], t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const n = stops.length - 1;
  const x = clamped * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(lerp(a[0], b[0], f)),
    Math.round(lerp(a[1], b[1], f)),
    Math.round(lerp(a[2], b[2], f)),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two sRGB colors. */
export function contrastRatio(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const L1 = relativeLuminance(...a);
  const L2 = relativeLuminance(...b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

const HI: [number, number, number] = [243, 238, 227]; // --text-hi
const LO: [number, number, number] = [20, 19, 15]; // near --bg

export function pickFg(bg: [number, number, number]): string {
  const onHi = contrastRatio(bg, HI);
  const onLo = contrastRatio(bg, LO);
  // Prefer light text on dark fills when both pass; otherwise pick the higher ratio.
  if (onHi >= 4.5 && onHi >= onLo) return "var(--text-hi)";
  if (onLo >= 4.5) return "rgb(20,19,15)";
  return onHi >= onLo ? "var(--text-hi)" : "rgb(20,19,15)";
}

export function rgbCss(rgb: [number, number, number], alpha = 1): string {
  return alpha >= 1
    ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
    : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export function buildSequentialScale(values: number[]): HeatScale {
  const finite = values.filter(v => Number.isFinite(v));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 0;
  const mid = (min + max) / 2;
  const range = max - min;

  const t = (value: number) => (range === 0 ? 0.5 : (value - min) / range);

  return {
    kind: "sequential",
    min,
    max,
    mid,
    t,
    bg(value: number) {
      const rgb = sampleStops(SEQUENTIAL_RGB, t(value));
      return rgbCss(rgb);
    },
    fg(value: number) {
      return pickFg(sampleStops(SEQUENTIAL_RGB, t(value)));
    },
  };
}

export function buildDivergingScale(values: number[]): HeatScale {
  const finite = values.filter(v => Number.isFinite(v));
  const absMax = finite.length ? Math.max(...finite.map(Math.abs), 0) : 0;
  const min = -absMax;
  const max = absMax;
  const mid = 0;

  const t = (value: number) => {
    if (absMax === 0) return 0.5;
    return 0.5 + 0.5 * (Math.max(-absMax, Math.min(absMax, value)) / absMax);
  };

  return {
    kind: "diverging",
    min,
    max,
    mid,
    t,
    bg(value: number) {
      return rgbCss(sampleStops(DIVERGING_RGB, t(value)));
    },
    fg(value: number) {
      return pickFg(sampleStops(DIVERGING_RGB, t(value)));
    },
  };
}

export interface ChainHeatScales {
  iv: HeatScale;
  absDelta: HeatScale;
  theta: HeatScale;
  volumeMax: number;
  oiMax: number;
}

export interface ChainHeatRow {
  callIv: number;
  putIv: number;
  callDelta: number;
  putDelta: number;
  callTheta: number;
  putTheta: number;
  callVolume: number | null;
  putVolume: number | null;
  callOi: number | null;
  putOi: number | null;
}

/** Precompute scales once per visible chain window (call from useMemo). */
export function buildChainHeatScales(rows: ChainHeatRow[]): ChainHeatScales {
  const ivs: number[] = [];
  const absDeltas: number[] = [];
  const thetas: number[] = [];
  let volumeMax = 0;
  let oiMax = 0;

  for (const r of rows) {
    ivs.push(r.callIv, r.putIv);
    absDeltas.push(Math.abs(r.callDelta), Math.abs(r.putDelta));
    thetas.push(r.callTheta, r.putTheta);
    if (r.callVolume != null) volumeMax = Math.max(volumeMax, r.callVolume);
    if (r.putVolume != null) volumeMax = Math.max(volumeMax, r.putVolume);
    if (r.callOi != null) oiMax = Math.max(oiMax, r.callOi);
    if (r.putOi != null) oiMax = Math.max(oiMax, r.putOi);
  }

  return {
    iv: buildSequentialScale(ivs),
    absDelta: buildSequentialScale(absDeltas),
    theta: buildDivergingScale(thetas),
    volumeMax,
    oiMax,
  };
}

/** Palette self-check: every sequential/diverging stop must allow ≥4.5:1 text. */
export function paletteMeetsContrast(minRatio = 4.5): boolean {
  const check = (stops: readonly [number, number, number][]) =>
    stops.every(s => {
      const fg = pickFg(s as [number, number, number]);
      const fgRgb: [number, number, number] =
        fg === "var(--text-hi)" ? HI : LO;
      return contrastRatio(s as [number, number, number], fgRgb) >= minRatio;
    });
  return check(SEQUENTIAL_RGB) && check(DIVERGING_RGB);
}
