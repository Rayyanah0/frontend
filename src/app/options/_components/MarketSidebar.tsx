"use client";

import { memo } from "react";
import { VolSmile } from "../../../components/VolSmile";
import { AlertsPanel } from "../../../components/AlertsPanel";
import { SpotPriceChart } from "../../../components/SpotPriceChart";
import { EXPIRIES, fmtSpot } from "../../../lib/pricing";
import { useBackendData } from "../../../lib/context/BackendDataContext";
import { usePriceHistory } from "../../../lib/usePriceHistory";
import { useHydrated } from "../../../lib/useHydrated";

function MarketSidebarImpl({sym,spot,vol}:{sym:string;spot:number;vol:number}){
  const hydrated=useHydrated();
  const {positions:backendPositions,greeks:portGreeks}=useBackendData();
  const priceHistory=usePriceHistory(sym,spot);
  return(
    <aside style={{width:236,flexShrink:0,borderRight:"1px solid var(--border-default)",
      overflowY:"auto",padding:"14px 12px",display:"flex",flexDirection:"column",gap:18,
      background:"var(--bg-raised)"}}>

      <SpotPriceChart history={priceHistory} width={212} height={70}/>

      <VolSmile baseVol={vol} width={212} height={110}/>

      <AlertsPanel sym={sym} spot={spot}/>

      <div>
        <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--text-lo)",marginBottom:8}}>Market</div>
        {[["Spot",fmtSpot(spot)],["ATM IV",`${Math.round(vol*100)}%`],
          ["25Δ Skew","-4.2%"],["OI Calls","$284K"],["OI Puts","$198K"],["P/C Ratio","0.70"]
        ].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",
            borderBottom:"1px solid var(--border-subtle)"}}>
            <span style={{fontSize:11,color:"var(--text-lo)"}}>{k}</span>
            <span className="num" style={{fontSize:11,color:"var(--text-hi)"}}>{v}</span>
          </div>
        ))}
      </div>

      <div>
        <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--text-lo)",marginBottom:8}}>OI by Expiry</div>
        {EXPIRIES.slice(0,4).map((e,i)=>{
          const pct=[42,28,18,12][i];
          return(
            <div key={e.label} style={{marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                <span style={{fontSize:10,color:"var(--text-lo)"}}>{e.label}</span>
                <span className="num" style={{fontSize:10,color:"var(--text-mid)"}}>{pct}%</span>
              </div>
              <div style={{height:3,background:"var(--bg-overlay)",borderRadius:0}}>
                <div style={{width:`${pct}%`,height:"100%",borderRadius:0,background:`rgba(181,150,101,${0.3+pct/100*0.5})`}}/>
              </div>
            </div>
          );
        })}
      </div>

      {hydrated&&backendPositions.length>0&&(
        <div>
          <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",color:"var(--text-lo)",marginBottom:8}}>Portfolio Greeks</div>
          {[{g:"Δ Net Delta",v:portGreeks.delta,dp:3},{g:"Γ Net Gamma",v:portGreeks.gamma,dp:4},
            {g:"Θ Daily",v:portGreeks.theta,dp:4},{g:"V Vega",v:portGreeks.vega,dp:3}
          ].map(item=>(
            <div key={item.g} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",
              borderBottom:"1px solid var(--border-subtle)"}}>
              <span style={{fontSize:10,color:"var(--text-lo)",fontFamily:"var(--font-mono)"}}>{item.g}</span>
              <span className="num" style={{fontSize:11,
                color:item.g.includes("Θ")?"var(--put)":item.v>=0?"var(--call)":"var(--put)"}}>
                {item.v>=0?"+":"\u2212"}{Math.abs(item.v).toFixed(item.dp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
export const MarketSidebar=memo(MarketSidebarImpl);