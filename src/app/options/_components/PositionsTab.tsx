"use client";

import Link from "next/link";
import { MARKETS, bs, smileVol, fmtK } from "../../../lib/pricing";
import { useBackendData } from "../../../lib/context/BackendDataContext";
import { useSpotFeedContext } from "../../../lib/context/SpotFeedContext";

interface Props{spot:number;vol:number;onBack:()=>void;}

export function PositionsTab({spot,vol,onBack}:Props){
  const {data:spotData}=useSpotFeedContext();
  const {positions:backendPositions}=useBackendData();
  // Backend positions don't store per-position Greeks (only the entry
  // premium/spot) — GET /api/v1/portfolio/greeks gives the aggregate, but
  // the per-row columns in the table below need a live figure for each
  // position individually, so this recomputes them the same way
  // /api/v1/portfolio/greeks does server-side: reprice at current
  // spot/vol for that position's own underlying, same static
  // expiry_days-as-t simplification the backend uses for closing.
  const positionLiveGreeks=(pos:{underlying:string;strike:number;expiry_days:number;option_type:"call"|"put"})=>{
    const posSpot=spotData?.prices[pos.underlying]
      ?? MARKETS.find(m=>m.sym===pos.underlying)?.price ?? spot;
    const posVol=spotData?.vols[pos.underlying]
      ?? MARKETS.find(m=>m.sym===pos.underlying)?.vol ?? vol;
    const posT=pos.expiry_days/365;
    const v=smileVol(posVol,pos.strike/posSpot);
    return bs(posSpot,pos.strike,v,posT,pos.option_type==="call");
  };
  return(
            <div style={{flex:1,overflowY:"auto"}}>
              {backendPositions.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:8}}>
                  <div style={{fontSize:13,color:"var(--text-lo)"}}>No open positions</div>
                  <button onClick={()=>onBack()} style={{fontSize:11,color:"var(--brand)",background:"none",border:"none",cursor:"pointer"}}>← Back to chain</button>
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid var(--border-default)"}}>
                      {["Asset","Type","Side","Strike","Expiry","Qty","Δ","Γ","Θ","V",""].map(h=>(
                        <th key={h} style={{padding:"6px 8px",fontSize:10,fontWeight:500,textTransform:"uppercase",
                          letterSpacing:"0.05em",color:"var(--text-lo)",textAlign:"right",background:"var(--bg-raised)"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {backendPositions.map(pos=>{
                      const sign=pos.position_type==="short"?-1:1;
                      const g=positionLiveGreeks(pos);
                      return(
                      <tr key={pos.id} style={{borderBottom:"1px solid var(--border-subtle)"}}>
                        <td style={{padding:"8px",fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{pos.underlying}</td>
                        <td style={{padding:"8px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:0,
                            background:pos.position_type==="short"?"var(--put-dim)":"var(--call-dim)",
                            color:pos.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                            {pos.position_type}
                          </span>
                        </td>
                        <td style={{padding:"8px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",borderRadius:0,
                            background:pos.option_type==="call"?"var(--call-dim)":"var(--put-dim)",
                            color:pos.option_type==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                            {pos.option_type}
                          </span>
                        </td>
                        {[fmtK(pos.strike),`${pos.expiry_days}D`,pos.contracts.toFixed(0),
                          (sign*g.delta*pos.contracts).toFixed(3),(sign*g.gamma*pos.contracts).toFixed(4),
                          (sign*g.theta*pos.contracts).toFixed(4),(sign*g.vega*pos.contracts).toFixed(3)
                        ].map((v,j)=>(
                          <td key={j} className="num" style={{padding:"8px",fontSize:11,textAlign:"right",
                            color:j===5?"var(--put)":"var(--text-hi)"}}>{v}</td>
                        ))}
                        <td style={{padding:"4px 8px",textAlign:"right"}}>
                          <Link href="/portfolio" style={{fontSize:10,color:"var(--brand)",textDecoration:"none"}}>Manage →</Link>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
  );
}
