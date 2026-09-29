"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHAIN_COLUMNS,
  filterStrikeWindow,
  findAtmIndex,
  findAtmIndexInFiltered,
  loadColumnPrefs,
  saveColumnPrefs,
  type ChainColumnId,
  type StrikeWindowMode,
} from "./chainUtils";
import { fmtK, fmtN, type Greeks } from "../../lib/pricing";

export interface ChainRow {
  strike: number;
  call: Greeks;
  put: Greeks;
  itmCall: boolean;
  itmPut: boolean;
}

interface Props {
  chain: ChainRow[];
  spot: number;
  loading?: boolean;
  compareChain?: ChainRow[] | null;
  compareLabel?: string;
  focusedStrike?: number | null;
  onFocusStrike?: (strike: number) => void;
  onTrade: (row: ChainRow, side: "call" | "put", mode: "buy" | "write") => void;
  jumpToken?: number;
}

function cellValue(
  g: Greeks,
  side: "call" | "put",
  strike: number,
  spot: number,
  col: ChainColumnId,
  spread: number
): string {
  const mid = g.premium;
  const bid = Math.max(0, mid - spread);
  const ask = mid + spread;
  const intrinsic = side === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  switch (col) {
    case "bid": return fmtN(bid);
    case "ask": return fmtN(ask);
    case "mid": return fmtN(mid);
    case "iv": return (g.iv * 100).toFixed(1);
    case "delta": return g.delta.toFixed(3);
    case "gamma": return g.gamma.toFixed(4);
    case "theta": return g.theta.toFixed(4);
    case "vega": return g.vega.toFixed(3);
    case "intrinsic": return fmtN(intrinsic);
    case "timeValue": return fmtN(Math.max(0, mid - intrinsic));
    case "breakeven":
      return fmtK(side === "call" ? strike + mid : strike - mid);
    default: return "—";
  }
}

export function AdvancedChain({
  chain, spot, loading, compareChain, compareLabel, focusedStrike, onFocusStrike, onTrade, jumpToken,
}: Props) {
  const [cols, setCols] = useState<ChainColumnId[]>(() => loadColumnPrefs());
  const [chooserOpen, setChooserOpen] = useState(false);
  const [windowMode, setWindowMode] = useState<"all" | "atm" | "delta">("atm");
  const [atmN, setAtmN] = useState(10);
  const [deltaMin, setDeltaMin] = useState(0.1);
  const [deltaMax, setDeltaMax] = useState(0.4);
  const [compareOn, setCompareOn] = useState(false);
  const atmRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    saveColumnPrefs(cols);
  }, [cols]);

  const mode: StrikeWindowMode = useMemo(() => {
    if (windowMode === "all") return { type: "all" };
    if (windowMode === "delta") return { type: "delta", min: deltaMin, max: deltaMax, side: "both" };
    return { type: "atm", n: atmN };
  }, [windowMode, atmN, deltaMin, deltaMax]);

  const filtered = useMemo(() => filterStrikeWindow(chain, mode), [chain, mode]);
  const atmIdxFull = findAtmIndex(chain);
  const atmIdx = findAtmIndexInFiltered(filtered);

  useEffect(() => {
    atmRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [jumpToken, chain, mode]);

  const toggleCol = (id: ChainColumnId) => {
    setCols(prev => (prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]));
  };

  const activeCols = CHAIN_COLUMNS.filter(c => cols.includes(c.id));

  const renderSide = (row: ChainRow, side: "call" | "put") => {
    const g = side === "call" ? row.call : row.put;
    const spread = Math.max(0.00001, g.premium * 0.003);
    return activeCols.map(col => {
      const tradeable = col.id === "bid" || col.id === "ask";
      const mode = col.id === "bid" ? "write" : "buy";
      return (
        <div
          key={`${side}-${col.id}`}
          className={`cc${tradeable ? ` tradeable ${side}` : ""}${col.id === "iv" || col.id === "delta" ? " brand" : ""}`}
          title={tradeable ? (mode === "write" ? "Click to write (sell)" : "Click to buy") : undefined}
          onClick={tradeable ? () => onTrade(row, side, mode as "buy" | "write") : undefined}
          style={{ minWidth: col.width, textAlign: "right", padding: "0 4px" }}
        >
          {cellValue(g, side, row.strike, spot, col.id, spread)}
        </div>
      );
    });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "6px 10px", borderBottom: "1px solid var(--border-default)", background: "var(--bg-raised)",
      }}>
        <button onClick={() => setChooserOpen(v => !v)} style={chipStyle(chooserOpen)}>Columns</button>
        <select
          value={windowMode}
          onChange={e => setWindowMode(e.target.value as typeof windowMode)}
          style={selectStyle}
          aria-label="Strike window"
        >
          <option value="all">All strikes</option>
          <option value="atm">±N around ATM</option>
          <option value="delta">Delta range</option>
        </select>
        {windowMode === "atm" && (
          <label style={{ fontSize: 11, color: "var(--text-lo)", display: "flex", alignItems: "center", gap: 4 }}>
            ±
            <input
              type="number" min={1} max={50} value={atmN}
              onChange={e => setAtmN(Math.max(1, parseInt(e.target.value, 10) || 10))}
              style={{ width: 44, ...inputStyle }}
            />
          </label>
        )}
        {windowMode === "delta" && (
          <label style={{ fontSize: 11, color: "var(--text-lo)", display: "flex", alignItems: "center", gap: 4 }}>
            |Δ|
            <input type="number" min={0} max={1} step={0.05} value={deltaMin}
              onChange={e => setDeltaMin(Math.max(0, parseFloat(e.target.value) || 0))}
              style={{ width: 52, ...inputStyle }} />
            –
            <input type="number" min={0} max={1} step={0.05} value={deltaMax}
              onChange={e => setDeltaMax(Math.min(1, parseFloat(e.target.value) || 1))}
              style={{ width: 52, ...inputStyle }} />
          </label>
        )}
        <button onClick={() => {
          atmRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        }} style={chipStyle(false)}>Jump to ATM</button>
        {compareChain && (
          <button onClick={() => setCompareOn(v => !v)} style={chipStyle(compareOn)}>
            Compare {compareLabel ?? "expiry"}
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-lo)" }}>
          {filtered.length}/{chain.length} strikes · ATM idx {atmIdx >= 0 ? atmIdx : "—"}
          {atmIdxFull >= 0 && windowMode !== "all" ? ` (full ${atmIdxFull})` : ""}
        </span>
      </div>

      {chooserOpen && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 10px",
          borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)",
        }}>
          {CHAIN_COLUMNS.map(c => (
            <label key={c.id} style={{ fontSize: 11, color: "var(--text-mid)", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={cols.includes(c.id)} onChange={() => toggleCol(c.id)} />
              {c.header}
            </label>
          ))}
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflow: "auto" }}>
        {loading && chain.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 12, color: "var(--text-lo)" }}>
            Loading chain…
          </div>
        ) : (
          <>
            <div className="chain-header" style={{ display: "flex", position: "sticky", top: 0, zIndex: 2 }}>
              {activeCols.map(c => <div key={`c-${c.id}`} className="ch call" style={{ minWidth: c.width }}>{c.header}</div>)}
              <div className="ch center" style={{ minWidth: 72 }}>Strike</div>
              {activeCols.map(c => <div key={`p-${c.id}`} className="ch put" style={{ minWidth: c.width }}>{c.header}</div>)}
              {compareOn && compareChain && (
                <div className="ch center" style={{ minWidth: 80, borderLeft: "1px solid var(--border-default)" }}>
                  {compareLabel ?? "Cmp"} mid C/P
                </div>
              )}
            </div>

            {atmIdx >= 0 && (
              <div
                ref={atmRef}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  padding: "4px 0", background: "var(--atm-dim)", borderBottom: "1px solid var(--atm)",
                  fontSize: 10, color: "var(--atm)", fontWeight: 600, position: "sticky", top: 28, zIndex: 1,
                }}
              >
                ATM · Spot {fmtK(spot)}
              </div>
            )}

            {filtered.map((row, i) => {
              const isAtm = i === atmIdx;
              const focused = focusedStrike === row.strike;
              const cmp = compareChain?.find(r => Math.abs(r.strike - row.strike) / row.strike < 0.002);
              return (
                <div
                  key={row.strike}
                  className={`chain-row${row.itmCall ? " itm-call" : ""}${row.itmPut ? " itm-put" : ""}`}
                  onClick={() => onFocusStrike?.(row.strike)}
                  style={{
                    background: focused ? "var(--bg-overlay)" : isAtm ? "var(--atm-dim)" : undefined,
                    outline: focused ? "1px solid var(--brand)" : undefined,
                    display: "flex",
                    cursor: "default",
                  }}
                >
                  {renderSide(row, "call")}
                  <div className={`strike-cell${isAtm ? " atm" : ""}`} style={{ minWidth: 72 }}>
                    {fmtK(row.strike)}
                    {isAtm && <div style={{ fontSize: 7, marginTop: 1, opacity: 0.6 }}>ATM</div>}
                  </div>
                  {renderSide(row, "put")}
                  {compareOn && compareChain && (
                    <div className="cc" style={{ minWidth: 80, borderLeft: "1px solid var(--border-subtle)", fontSize: 10 }}>
                      {cmp
                        ? `${fmtN(cmp.call.premium)} / ${fmtN(cmp.put.premium)}`
                        : "—"}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

const chipStyle = (on: boolean): React.CSSProperties => ({
  fontSize: 11, padding: "3px 8px", cursor: "pointer",
  background: on ? "var(--atm-dim)" : "transparent",
  border: "1px solid var(--border-default)",
  color: on ? "var(--atm)" : "var(--text-lo)",
});

const selectStyle: React.CSSProperties = {
  fontSize: 11, padding: "3px 6px", background: "var(--bg-overlay)",
  border: "1px solid var(--border-default)", color: "var(--text-mid)",
};

const inputStyle: React.CSSProperties = {
  fontSize: 11, padding: "2px 4px", background: "var(--bg-overlay)",
  border: "1px solid var(--border-default)", color: "var(--text-hi)",
  fontFamily: "var(--font-mono)",
};
