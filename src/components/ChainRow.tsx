"use client";

import { memo, useEffect, useRef, useState } from "react";
import { fmtN, seededRandom as seeded } from "../lib/pricing";
import type { ChainRowData } from "../lib/chainRows";

interface Props {
  row: ChainRowData;
  isAtm: boolean;
  fmtStrike: (k: number) => string;
  onTrade: (row: ChainRowData, side: "call" | "put", mode: "buy" | "write") => void;
}

function useFlash(value: number) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"" | "flash-up" | "flash-down">("");
  useEffect(() => {
    if (prev.current !== value) {
      const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) setDir(value > prev.current ? "flash-up" : "flash-down");
      prev.current = value;
      const id = setTimeout(() => setDir(""), 350);
      return () => clearTimeout(id);
    }
  }, [value]);
  return dir;
}

function ChainRowImpl({ row, isAtm, fmtStrike, onTrade }: Props) {
  const sp = Math.max(0.00001, row.call.premium * 0.003);
  const vol = Math.round(seeded(row.strike * 1000) * 200 + 20);
  const oi = Math.round(seeded(row.strike * 1000 + 7) * 5000 + 100);
  const callFlash = useFlash(row.call.premium);
  const putFlash = useFlash(row.put.premium);
  return (
    <div className={`chain-row${row.itmCall ? " itm-call" : ""}${row.itmPut ? " itm-put" : ""}`}
      style={{ background: isAtm ? "var(--atm-dim)" : undefined }}>
      <div className="cc">{vol}</div>
      <div className="cc">{oi.toLocaleString()}</div>
      <div className={`cc tradeable call ${callFlash}`} title="Click to write (sell)" onClick={() => onTrade(row, "call", "write")}>
        {fmtN(Math.max(0, row.call.premium - sp))}
      </div>
      <div className={`cc tradeable call ${callFlash}`} title="Click to buy" onClick={() => onTrade(row, "call", "buy")}>
        {fmtN(row.call.premium + sp)}
      </div>
      <div className="cc brand">{(row.call.iv * 100).toFixed(1)}</div>
      <div className={`strike-cell${isAtm ? " atm" : ""}`}>
        {fmtStrike(row.strike)}
        {isAtm && <div style={{ fontSize: 7, marginTop: 1, opacity: 0.6 }}>ATM</div>}
      </div>
      <div className="cc brand">{(row.put.iv * 100).toFixed(1)}</div>
      <div className={`cc tradeable put ${putFlash}`} title="Click to buy" onClick={() => onTrade(row, "put", "buy")}>
        {fmtN(row.put.premium + sp)}
      </div>
      <div className={`cc tradeable put ${putFlash}`} title="Click to write (sell)" onClick={() => onTrade(row, "put", "write")}>
        {fmtN(Math.max(0, row.put.premium - sp))}
      </div>
      <div className="cc">{oi.toLocaleString()}</div>
      <div className="cc">{vol}</div>
    </div>
  );
}

/** Memoized: re-renders only when this strike's row object (structurally shared) or ATM flag changes. */
export const ChainRow = memo(ChainRowImpl);
