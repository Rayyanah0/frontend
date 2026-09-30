"use client";

import { memo } from "react";
import { useBackendData } from "../../../../lib/context/BackendDataContext";
import { useHydrated } from "../../../../lib/useHydrated";
import type { ViewTab } from "./types";

interface Props{viewTab:ViewTab;setViewTab:(t:ViewTab)=>void;sym:string;expiryLabel:string;strikes:number;}

function ViewTabsImpl({viewTab,setViewTab,sym,expiryLabel,strikes}:Props){
  const hydrated=useHydrated();
  const {positions:backendPositions}=useBackendData();
  const expiry={label:expiryLabel};
  const chain={length:strikes};
  return(
          <div style={{display:"flex",borderBottom:"1px solid var(--border-default)",padding:"0 8px",background:"var(--bg-raised)"}}>
            {(["chain","positions","strategies","surface"] as const).map(tab=>(
              <button key={tab} onClick={()=>setViewTab(tab)} style={{
                padding:"8px 14px",border:"none",background:"transparent",cursor:"pointer",
                fontSize:12,fontWeight:500,textTransform:"capitalize",
                color:viewTab===tab?"var(--text-hi)":"var(--text-lo)",
                borderBottom:viewTab===tab?"2px solid var(--brand)":"2px solid transparent",
                marginBottom:-1,
              }}>{tab}{tab==="positions"&&hydrated&&backendPositions.length>0?` (${backendPositions.length})`:""}</button>
            ))}
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",paddingRight:4}}>
              <span style={{fontSize:10,color:"var(--text-lo)"}}>{sym}-USD · {expiry.label} · {chain.length} strikes · Click ask to buy, bid to write</span>
            </div>
          </div>
  );
}
export const ViewTabs=memo(ViewTabsImpl);
