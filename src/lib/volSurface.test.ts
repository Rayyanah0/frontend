import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSurfaceGrid, buildSurfaceMesh, extractSlice } from "./volSurface";

describe("volSurface mesh", () => {
  const grid = buildSurfaceGrid(0.6, [0.9, 1.0, 1.1], [7, 30, 90]);

  it("builds a mesh with correct vertex and triangle counts", () => {
    const mesh = buildSurfaceMesh(grid);
    assert.equal(mesh.rows, 3);
    assert.equal(mesh.cols, 3);
    assert.equal(mesh.positions.length, 3 * 3 * 3);
    assert.equal(mesh.colors.length, 3 * 3 * 3);
    assert.equal(mesh.indices.length, 2 * 2 * 6);
    assert.ok(mesh.maxIv > mesh.minIv);
  });

  it("handles empty grid", () => {
    const mesh = buildSurfaceMesh([]);
    assert.equal(mesh.positions.length, 0);
    assert.equal(mesh.indices.length, 0);
  });

  it("extracts smile and term slices", () => {
    const smile = extractSlice(grid, "expiry", 0);
    assert.equal(smile.points.length, 3);
    const term = extractSlice(grid, "strike", 1);
    assert.equal(term.points.length, 3);
  });
});
