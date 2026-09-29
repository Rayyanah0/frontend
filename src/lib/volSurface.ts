import { smileVol } from "./pricing";

export interface SurfaceCell {
  moneyness: number;
  days: number;
  iv: number;
}

// Real crypto vol surfaces aren't just a smile repeated at every expiry — the
// skew/curvature away from ATM typically dampens for longer-dated options
// (near-term uncertainty is sharper, far-dated smooths out). This isolates
// smileVol's non-ATM component and shrinks it as days-to-expiry grows.
export function surfaceVol(baseVol: number, moneyness: number, days: number): number {
  const smile = smileVol(baseVol, moneyness);
  const nonAtmComponent = smile - baseVol;
  const dampen = 1 / (1 + (days / 365) * 1.5);
  return baseVol + nonAtmComponent * dampen;
}

export function buildSurfaceGrid(baseVol: number, moneyness: number[], expiryDays: number[]): SurfaceCell[][] {
  return expiryDays.map(days =>
    moneyness.map(m => ({ moneyness: m, days, iv: surfaceVol(baseVol, m, days) }))
  );
}

export interface SurfaceMesh {
  /** Flat position buffer: [x,y,z, x,y,z, ...] where x=moneyness, y=iv, z=days-normalized. */
  positions: Float32Array;
  /** Flat RGB colors [0,1]: matching vertex count. */
  colors: Float32Array;
  /** Triangle indices. */
  indices: Uint16Array;
  rows: number;
  cols: number;
  minIv: number;
  maxIv: number;
}

/** Shared ochre sequential colormap (matches heatScale sequential). */
function ivColor(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [54 / 255, 42 / 255, 20 / 255],
    [89 / 255, 62 / 255, 24 / 255],
    [140 / 255, 98 / 255, 36 / 255],
    [181 / 255, 150 / 255, 101 / 255],
    [232 / 255, 214 / 255, 168 / 255],
  ];
  const clamped = Math.min(1, Math.max(0, t));
  const n = stops.length - 1;
  const x = clamped * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

/**
 * Build a triangulated mesh from a surface grid for WebGL.
 * X = moneyness (centered at 1), Y = IV, Z = days / 365.
 */
export function buildSurfaceMesh(grid: SurfaceCell[][]): SurfaceMesh {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  if (rows === 0 || cols === 0) {
    return {
      positions: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint16Array(0),
      rows: 0,
      cols: 0,
      minIv: 0,
      maxIv: 0,
    };
  }

  let minIv = Infinity;
  let maxIv = -Infinity;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.iv < minIv) minIv = cell.iv;
      if (cell.iv > maxIv) maxIv = cell.iv;
    }
  }
  if (!Number.isFinite(minIv)) { minIv = 0; maxIv = 1; }
  const range = maxIv - minIv || 1;

  const positions = new Float32Array(rows * cols * 3);
  const colors = new Float32Array(rows * cols * 3);
  let vi = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      positions[vi * 3] = cell.moneyness - 1;
      positions[vi * 3 + 1] = cell.iv;
      positions[vi * 3 + 2] = cell.days / 365;
      const t = (cell.iv - minIv) / range;
      const [cr, cg, cb] = ivColor(t);
      colors[vi * 3] = cr;
      colors[vi * 3 + 1] = cg;
      colors[vi * 3 + 2] = cb;
      vi++;
    }
  }

  const indices = new Uint16Array((rows - 1) * (cols - 1) * 6);
  let ii = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices[ii++] = a;
      indices[ii++] = d;
      indices[ii++] = b;
      indices[ii++] = b;
      indices[ii++] = d;
      indices[ii++] = e;
    }
  }

  return { positions, colors, indices, rows, cols, minIv, maxIv };
}

/** Extract fixed-expiry smile or fixed-moneyness term structure for 2D slice charts. */
export function extractSlice(
  grid: SurfaceCell[][],
  mode: "expiry" | "strike",
  index: number
): { label: string; points: { x: number; iv: number }[] } {
  if (grid.length === 0) return { label: "", points: [] };
  if (mode === "expiry") {
    const row = grid[Math.min(Math.max(0, index), grid.length - 1)];
    return {
      label: `${row[0].days}D smile`,
      points: row.map(c => ({ x: c.moneyness, iv: c.iv })),
    };
  }
  const cols = grid[0].length;
  const c = Math.min(Math.max(0, index), cols - 1);
  return {
    label: `${Math.round(grid[0][c].moneyness * 100)}% term`,
    points: grid.map(row => ({ x: row[c].days, iv: row[c].iv })),
  };
}
