"use client";

import { memo, useMemo, useRef, useEffect } from "react";
import { AppHeader } from "../../../components/AppHeader";
import { WalletConnect } from "../../../components/WalletConnect";
import { StarButton } from "../../../components/StarButton";
import { MARKETS, fmtSpot } from "../../../lib/pricing";
import { useBackendData } from "../../../lib/context/BackendDataContext";
import { useHydrated } from "../../../lib/useHydrated";
import type { Expiry, Market } from "./types";

interface Props{sym:string;setSym:(s:string)=>void;spot:number;vol:number;market:Market;
  expiries:Expiry[];expiry:Expiry;setExpiry:(e:Expiry)=>void;}

function MarketHeaderImpl({sym,setSym,spot,vol,market,expiries,expiry,setExpiry}:Props){
  const hydrated=useHydrated();
  const {watchlist}=useBackendData();
  const favorites=useMemo(()=>watchlist.map(w=>w.underlying),[watchlist]);
  const prevSpotRef=useRef(spot);
  // Standard "previous value" pattern: the ref holds what rendered last time.
  useEffect(()=>{prevSpotRef.current=spot;},[spot]);
  const priceDir=spot>=prevSpotRef.current;
  const sortedMarkets=useMemo(()=>{
    if(!hydrated)return MARKETS; // matches SSR order until this component's own mount effect fires
    return [...MARKETS].sort((a,b)=>{
      const aFav=favorites.includes(a.sym),bFav=favorites.includes(b.sym);
      return aFav===bFav?0:aFav?-1:1;
    });
  },[favorites,hydrated]);
  return(
      <AppHeader>
        <div style={{display:"flex",gap:1}}>
          {sortedMarkets.map(m=>(
            <div key={m.sym} style={{display:"flex",alignItems:"center",
              background:sym===m.sym?"var(--bg-overlay)":"transparent",
              borderBottom:sym===m.sym?"2px solid var(--brand)":"2px solid transparent"}}>
              <button onClick={()=>setSym(m.sym)} style={{
                padding:"4px 4px 4px 10px",border:"none",background:"none",cursor:"pointer",
                fontSize:12,fontWeight:600,transition:"all 120ms",
                color:sym===m.sym?"var(--text-hi)":"var(--text-mid)",
              }}>{m.sym}</button>
              <StarButton sym={m.sym}/>
            </div>
          ))}
        </div>
        <div style={{width:1,height:20,background:"var(--border-default)"}}/>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span className="num" style={{fontSize:16,fontWeight:600,color:"var(--text-hi)"}}>{fmtSpot(spot)}</span>
          <span className="num" style={{fontSize:12,color:priceDir?"var(--call)":"var(--put)"}}>
            {priceDir?"+":"\u2212"}{Math.abs((spot/market.price-1)*100).toFixed(2)}%
          </span>
          <span style={{fontSize:11,color:"var(--text-lo)"}}>IV {Math.round(vol*100)}%</span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4}}>
          {expiries.map(e=>(
            <button key={e.label} onClick={()=>setExpiry(e)} style={{
              padding:"3px 7px",border:"none",borderRadius:0,cursor:"pointer",fontSize:11,
              background:expiry.label===e.label?"var(--atm-dim)":"transparent",
              color:expiry.label===e.label?"var(--atm)":"var(--text-lo)",
            }}>{e.label}</button>
          ))}
          <div style={{width:1,height:16,background:"var(--border-default)",margin:"0 8px"}}/>
          <WalletConnect />
        </div>
      </AppHeader>
  );
}
export const MarketHeader=memo(MarketHeaderImpl);
