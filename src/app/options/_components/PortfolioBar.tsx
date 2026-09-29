"use client";

import { useBackendData } from "../../../lib/context/BackendDataContext";
import { useHydrated } from "../../../lib/useHydrated";

export function PortfolioBar(){
  const hydrated=useHydrated();
  const {positions:backendPositions,greeks:portGreeks}=useBackendData();
  return(
    <>
          {hydrated&&backendPositions.length>0&&(
            <div style={{height:36,flexShrink:0,borderTop:"1px solid var(--border-default)",
              display:"flex",alignItems:"center",gap:20,padding:"0 16px",background:"var(--bg-raised)"}}>
              <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)"}}>Portfolio</span>
              {[{g:"Net Δ",v:portGreeks.delta,dp:3},{g:"Net Γ",v:portGreeks.gamma,dp:4},
                {g:"Daily Θ",v:portGreeks.theta,dp:4},{g:"Vega",v:portGreeks.vega,dp:3}
              ].map(item=>(
                <div key={item.g} style={{display:"flex",alignItems:"center",gap:5}}>
                  <span style={{fontSize:10,color:"var(--text-lo)"}}>{item.g}</span>
                  <span className="num" style={{fontSize:11,
                    color:item.g.includes("Θ")?"var(--put)":item.v>=0?"var(--call)":"var(--put)"}}>
                    {item.v>=0?"+":"\u2212"}{Math.abs(item.v).toFixed(item.dp)}
                  </span>
                </div>
              ))}
            </div>
          )}
    </>
  );
}
