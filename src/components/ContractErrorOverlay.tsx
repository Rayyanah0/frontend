"use client";

import { useEffect, useState } from "react";
import { onContractError, type ContractError } from "../lib/api/contractError";

// Development-only: shows API contract violations on-screen instead of
// letting them surface as NaN. Renders nothing in production builds.
export function ContractErrorOverlay() {
  const [errors, setErrors] = useState<ContractError[]>([]);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    return onContractError(e => setErrors(prev => [...prev.slice(-4), e]));
  }, []);
  if (process.env.NODE_ENV === "production" || errors.length === 0) return null;
  return (
    <div style={{position:"fixed",bottom:12,right:12,zIndex:9999,maxWidth:420,background:"#2a0d0d",
      border:"1px solid #c0392b",color:"#f5c6c0",fontSize:11,padding:10,fontFamily:"var(--font-mono)"}}>
      <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,marginBottom:6}}>
        <span>API contract violation</span>
        <button onClick={() => setErrors([])} style={{background:"none",border:"none",color:"inherit",cursor:"pointer"}}>×</button>
      </div>
      {errors.map((e, i) => <div key={i} style={{marginBottom:4}}>{e.message}</div>)}
    </div>
  );
}
