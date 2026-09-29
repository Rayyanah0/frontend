/**
 * GreekExposureHeatmap — Issue #64.
 *
 * Heat grid of Greek exposure by expiry bucket × strike bucket.
 * Click a cell to see contributing positions (click-through).
 */
"use client";

import { useMemo, useState } from "react";
import type { HeatCell, GreekKey } from "../lib/quantWorker";
import type { Position } from "../lib/api/types";

const EXPIRY_ORDER = ["≤14D", "15–30D", "31–60D", "61–90D", ">90D"];
const STRIKE_ORDER = ["Deep ITM", "ITM", "ATM", "OTM", "Deep OTM"];

interface Props {
  heatmap: HeatCell[];
  greek: GreekKey;
  positions: Position[];
  /** Called when user clicks a cell */
  onCellClick?: (positionIds: string[]) => void;
}

function heatColor(value: number, maxAbs: number): string {
  if (maxAbs === 0) return "var(--bg-elevated)";
  const t = Math.min(1, Math.abs(value) / maxAbs);
  const alpha = 0.12 + t * 0.55;
  return value >= 0
    ? `rgba(92,154,107,${alpha})`   // --call tint for positive exposure
    : `rgba(182,86,64,${alpha})`;   // --put tint for negative exposure
}

export function GreekExposureHeatmap({ heatmap, greek, positions, onCellClick }: Props) {
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);

  const maxAbs = useMemo(
    () => Math.max(...heatmap.map(c => Math.abs(c.value)), 0.0001),
    [heatmap]
  );

  // Build a lookup map
  const cellMap = useMemo(() => {
    const m = new Map<string, HeatCell>();
    for (const cell of heatmap) {
      m.set(`${cell.expiryBucket}|${cell.strikeBucket}`, cell);
    }
    return m;
  }, [heatmap]);

  const handleCellClick = (cell: HeatCell) => {
    setSelectedIds(cell.positionIds);
    onCellClick?.(cell.positionIds);
  };

  const selectedPositions = useMemo(() => {
    if (!selectedIds) return [];
    const ids = new Set(selectedIds);
    return positions.filter(p => ids.has(p.id));
  }, [selectedIds, positions]);

  if (heatmap.length === 0) {
    return (
      <div style={{ padding: 16, color: "var(--text-lo)", fontSize: 12 }}>
        No exposure data
      </div>
    );
  }

  const presentExpiries = EXPIRY_ORDER.filter(e => heatmap.some(c => c.expiryBucket === e));
  const presentStrikes = STRIKE_ORDER.filter(s => heatmap.some(c => c.strikeBucket === s));

  return (
    <div>
      {/* Grid */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ padding: "4px 8px", color: "var(--text-lo)", fontWeight: 500, textAlign: "left", fontSize: 10, whiteSpace: "nowrap" }}>
                Expiry ↓ / Strike →
              </th>
              {presentStrikes.map(sb => (
                <th key={sb} style={{
                  padding: "4px 8px", color: "var(--text-lo)", fontWeight: 500,
                  textAlign: "center", fontSize: 10,
                }}>
                  {sb}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {presentExpiries.map(eb => (
              <tr key={eb}>
                <td style={{
                  padding: "4px 8px", color: "var(--text-mid)", fontSize: 10,
                  fontFamily: "var(--font-mono)", whiteSpace: "nowrap",
                  borderRight: "1px solid var(--border-subtle)",
                }}>
                  {eb}
                </td>
                {presentStrikes.map(sb => {
                  const key = `${eb}|${sb}`;
                  const cell = cellMap.get(key);
                  const bg = cell ? heatColor(cell.value, maxAbs) : "transparent";
                  const isHovered = hoveredCell === key;
                  const isSelected = selectedIds && cell && cell.positionIds.some(id => selectedIds.includes(id));

                  return (
                    <td
                      key={sb}
                      title={cell ? `${cell.positionIds.length} position(s) · ${greek}: ${cell.value.toFixed(4)}` : "—"}
                      onClick={() => cell && handleCellClick(cell)}
                      onMouseEnter={() => setHoveredCell(key)}
                      onMouseLeave={() => setHoveredCell(null)}
                      style={{
                        padding: "6px 10px",
                        textAlign: "center",
                        background: isSelected ? "var(--atm-dim)" : isHovered && cell ? "var(--bg-overlay)" : bg,
                        cursor: cell ? "pointer" : "default",
                        border: isSelected ? "1px solid var(--atm)" : "1px solid var(--border-subtle)",
                        transition: "background 80ms",
                        minWidth: 72,
                      }}
                    >
                      {cell ? (
                        <span
                          className="num"
                          style={{
                            fontSize: 11,
                            color: cell.value >= 0 ? "var(--call)" : "var(--put)",
                          }}
                        >
                          {cell.value >= 0 ? "+" : ""}{cell.value.toFixed(3)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-lo)", fontSize: 10 }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Click-through: contributing positions */}
      {selectedPositions.length > 0 && (
        <div style={{
          marginTop: 10,
          border: "1px solid var(--atm)",
          background: "var(--bg-elevated)",
          padding: 10,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 8,
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--atm)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Contributing Positions ({selectedPositions.length})
            </span>
            <button
              onClick={() => setSelectedIds(null)}
              aria-label="Close position detail"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--text-lo)", fontSize: 12, lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {selectedPositions.map(p => (
              <div key={p.id} style={{
                display: "flex", gap: 12, alignItems: "center",
                padding: "4px 6px", background: "var(--bg-raised)", fontSize: 11,
              }}>
                <span style={{ color: p.option_type === "call" ? "var(--call)" : "var(--put)", fontWeight: 600 }}>
                  {p.option_type.toUpperCase()}
                </span>
                <span style={{ color: p.position_type === "long" ? "var(--call)" : "var(--put)" }}>
                  {p.position_type}
                </span>
                <span className="num" style={{ color: "var(--text-hi)" }}>
                  K={p.strike} · {p.expiry_days}D · ×{p.contracts}
                </span>
                <span style={{ color: "var(--text-lo)", fontSize: 10, marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
                  id:{p.id.slice(0, 8)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
