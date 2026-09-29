"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  buildSurfaceGrid,
  buildSurfaceMesh,
  extractSlice,
  type SurfaceCell,
} from "../lib/volSurface";

const MONEYNESS = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2];
const EXPIRY_DAYS = [7, 14, 30, 60, 90, 180];

interface Props {
  baseVol: number;
  selectedExpiryDays?: number;
  onSelectStrike?: (moneyness: number, days: number, iv: number) => void;
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

function SliceChart({
  points,
  label,
  xLabel,
}: {
  points: { x: number; iv: number }[];
  label: string;
  xLabel: string;
}) {
  const w = 280;
  const h = 120;
  if (points.length < 2) return null;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.iv);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const xr = x1 - x0 || 1;
  const yr = y1 - y0 || 1;
  const path = points
    .map((p, i) => {
      const x = 20 + ((p.x - x0) / xr) * (w - 40);
      const y = h - 20 - ((p.iv - y0) / yr) * (h - 40);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>{label}</div>
      <svg width={w} height={h} role="img" aria-label={label}>
        <path d={path} fill="none" stroke="var(--brand)" strokeWidth={1.5} />
        <text x={w / 2} y={h - 4} textAnchor="middle" fontSize={8} fill="var(--text-lo)">
          {xLabel}
        </text>
      </svg>
    </div>
  );
}

function DataTable({ grid }: { grid: SurfaceCell[][] }) {
  return (
    <table style={{ borderCollapse: "collapse", marginTop: 12 }}>
      <caption style={{ fontSize: 10, color: "var(--text-lo)", textAlign: "left", marginBottom: 6 }}>
        Implied volatility surface (accessible data table)
      </caption>
      <thead>
        <tr>
          <th scope="col" style={{ fontSize: 9, color: "var(--text-lo)", padding: 4 }}>Expiry</th>
          {MONEYNESS.map(m => (
            <th key={m} scope="col" style={{ fontSize: 9, color: "var(--text-lo)", padding: 4 }}>
              {Math.round(m * 100)}%
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.map((row, i) => (
          <tr key={i}>
            <th scope="row" style={{ fontSize: 9, color: "var(--text-lo)", padding: 4, textAlign: "right" }}>
              {EXPIRY_DAYS[i]}D
            </th>
            {row.map((cell, j) => (
              <td key={j} className="num" style={{ fontSize: 9, color: "var(--text-mid)", padding: 4, textAlign: "center" }}>
                {(cell.iv * 100).toFixed(1)}%
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const VERT = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uMVP;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

function matMul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function lookAt(eye: [number, number, number], target: [number, number, number]): Float32Array {
  const [ex, ey, ez] = eye;
  let zx = ex - target[0], zy = ey - target[1], zz = ez - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = zy * 0 - zz * 1, xy = zz * 0 - zx * 0, xz = zx * 1 - zy * 0;
  let xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * ex + xy * ey + xz * ez);
  m[13] = -(yx * ex + yy * ey + yz * ez);
  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[15] = 1;
  return m;
}

/**
 * WebGL 3D IV surface (compact raw WebGL — stays under the lazy-load budget).
 * Disposes GPU resources on unmount; respects prefers-reduced-motion.
 */
export function VolSurface3D({ baseVol, selectedExpiryDays, onSelectStrike }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ m: number; d: number; iv: number } | null>(null);
  const [sliceMode, setSliceMode] = useState<"expiry" | "strike">("expiry");
  const [sliceIdx, setSliceIdx] = useState(2);
  const [showModel, setShowModel] = useState(true);
  const [glOk, setGlOk] = useState(true);
  const angles = useRef({ yaw: 0.7, pitch: 0.45, dist: 2.8 });
  const dragging = useRef(false);
  const lastPtr = useRef({ x: 0, y: 0 });

  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const grid = useMemo(() => buildSurfaceGrid(baseVol, MONEYNESS, EXPIRY_DAYS), [baseVol]);
  const mesh = useMemo(() => buildSurfaceMesh(grid), [grid]);
  const slice = useMemo(() => extractSlice(grid, sliceMode, sliceIdx), [grid, sliceMode, sliceIdx]);

  const handleContextLost = useCallback((e: Event) => {
    e.preventDefault();
    setGlOk(false);
  }, []);

  useEffect(() => {
    if (!webglAvailable() || !canvasRef.current) {
      setGlOk(false);
      return;
    }
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl");
    if (!gl) {
      setGlOk(false);
      return;
    }

    canvas.addEventListener("webglcontextlost", handleContextLost);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Center & scale positions for viewing
    const pos = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      pos[i] = mesh.positions[i] * 2.2;
      pos[i + 1] = (mesh.positions[i + 1] - mesh.minIv) * 3.5;
      pos[i + 2] = mesh.positions[i + 2] * 2.2 - 0.6;
    }

    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    const colBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW);
    const aColor = gl.getAttribLocation(prog, "aColor");
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);

    const idxBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    const uMVP = gl.getUniformLocation(prog, "uMVP");
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.078, 0.075, 0.059, 1);

    let raf = 0;
    const draw = () => {
      const { yaw, pitch, dist } = angles.current;
      const eye: [number, number, number] = [
        dist * Math.cos(pitch) * Math.sin(yaw),
        dist * Math.sin(pitch),
        dist * Math.cos(pitch) * Math.cos(yaw),
      ];
      const proj = perspective((45 * Math.PI) / 180, canvas.width / canvas.height, 0.05, 50);
      const view = lookAt(eye, [0, 0.4, 0]);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uMVP, false, matMul(proj, view));
      if (showModel) {
        gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawElements(gl.LINES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    const hoverRef = { current: null as typeof hover };
    const onSelectRef = { current: onSelectStrike };

    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      lastPtr.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) {
        const rect = canvas.getBoundingClientRect();
        const u = (e.clientX - rect.left) / rect.width;
        const v = (e.clientY - rect.top) / rect.height;
        const ci = Math.min(MONEYNESS.length - 1, Math.max(0, Math.floor(u * MONEYNESS.length)));
        const ri = Math.min(EXPIRY_DAYS.length - 1, Math.max(0, Math.floor((1 - v) * EXPIRY_DAYS.length)));
        const cell = grid[ri]?.[ci];
        if (cell) {
          const h = { m: cell.moneyness, d: cell.days, iv: cell.iv };
          hoverRef.current = h;
          setHover(h);
        }
        return;
      }
      const dx = e.clientX - lastPtr.current.x;
      const dy = e.clientY - lastPtr.current.y;
      lastPtr.current = { x: e.clientX, y: e.clientY };
      angles.current.yaw += dx * 0.01;
      angles.current.pitch = Math.max(-1.2, Math.min(1.2, angles.current.pitch + dy * 0.01));
    };
    const onUp = () => { dragging.current = false; };
    const onClick = () => {
      const h = hoverRef.current;
      if (h) onSelectRef.current?.(h.m, h.d, h.iv);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      angles.current.dist = Math.max(1.2, Math.min(6, angles.current.dist + e.deltaY * 0.002));
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    void reduceMotion; // no auto-rotate (respects prefers-reduced-motion)

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(colBuf);
      gl.deleteBuffer(idxBuf);
      gl.deleteProgram(prog);
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    };
  }, [mesh, grid, showModel, reduceMotion, handleContextLost, onSelectStrike]);

  if (!glOk) {
    return (
      <div>
        <p style={{ fontSize: 12, color: "var(--put)", marginBottom: 8 }}>
          WebGL unavailable — showing data table. Switch to Heatmap tab for the 2D view.
        </p>
        <DataTable grid={grid} />
      </div>
    );
  }

  const expiryIdx = Math.max(0, EXPIRY_DAYS.indexOf(selectedExpiryDays ?? 30));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)" }}>
          3D IV Surface
        </span>
        <button
          type="button"
          onClick={() => setShowModel(v => !v)}
          style={{
            fontSize: 10, padding: "2px 8px", cursor: "pointer",
            border: "1px solid var(--border-default)",
            background: "var(--bg-elevated)", color: "var(--text-mid)",
          }}
        >
          {showModel ? "Model mesh" : "Wireframe"}
        </button>
        <button
          type="button"
          onClick={() => setSliceMode(m => (m === "expiry" ? "strike" : "expiry"))}
          style={{
            fontSize: 10, padding: "2px 8px", cursor: "pointer",
            border: "1px solid var(--border-default)",
            background: "var(--bg-elevated)", color: "var(--text-mid)",
          }}
        >
          Slice: {sliceMode === "expiry" ? "smile" : "term"}
        </button>
        <input
          type="range"
          min={0}
          max={sliceMode === "expiry" ? EXPIRY_DAYS.length - 1 : MONEYNESS.length - 1}
          value={sliceIdx}
          onChange={e => setSliceIdx(Number(e.target.value))}
          aria-label="Slice index"
        />
        {hover && (
          <span className="num" style={{ fontSize: 11, color: "var(--atm)" }}>
            K={Math.round(hover.m * 100)}% · {hover.d}D · IV {(hover.iv * 100).toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <canvas
          ref={canvasRef}
          width={560}
          height={360}
          style={{ flex: "1 1 420px", maxWidth: "100%", border: "1px solid var(--border-default)", background: "var(--bg)", cursor: "grab" }}
          role="img"
          aria-label="Interactive 3D implied volatility surface. Use the data table for screen readers."
        />
        <div style={{ flex: "0 0 280px" }}>
          <SliceChart
            points={slice.points}
            label={slice.label || (sliceMode === "expiry" ? `${EXPIRY_DAYS[expiryIdx]}D` : "term")}
            xLabel={sliceMode === "expiry" ? "Moneyness" : "Days"}
          />
          <DataTable grid={grid} />
        </div>
      </div>
    </div>
  );
}
