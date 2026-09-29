import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../../../lib/api/queryKeys";
import { EXPIRIES, bs, smileVol } from "../../../lib/pricing";
import { getChain, getExpiryCalendar } from "../../../lib/api/market";
import type { OptionChainEntry } from "../../../lib/api/types";
import type { ChainRow, Expiry } from "./types";

// Single mapper for backend chain entries (was copy-pasted twice in page.tsx).
export function mapChainEntries(entries:OptionChainEntry[]):ChainRow[]{
  return entries.map(e=>({
    strike:e.strike,
    call:{premium:e.call.premium,delta:e.call.delta,gamma:e.call.gamma,theta:e.call.theta,vega:e.call.vega,iv:e.call.iv},
    put:{premium:e.put.premium,delta:e.put.delta,gamma:e.put.gamma,theta:e.put.theta,vega:e.put.vega,iv:e.put.iv},
    itmCall:e.is_itm_call,itmPut:e.is_itm_put,
  }));
}

// Backend's expiry list happens to be the same across every underlying,
// but fetching per-symbol keeps this correct if that ever changes. Falls
// back to the local EXPIRIES until/unless the backend answers.
export function useExpiries(sym:string):Expiry[]{
  const q=useQuery({
    queryKey:queryKeys.expiries(sym),
    queryFn:()=>getExpiryCalendar(sym),
    select:(cal)=>cal.expiries.map(e=>({label:e.label,days:e.days_to_expiry})),
  });
  return q.data??EXPIRIES;
}

// Fetch + 4s polling + local Black-Scholes fallback when the backend is down.
// Deliberately not re-fetching on every spot tick: spot/vol only feed the
// fallback, never the query key.
export function useOptionChain(sym:string,expiryDays:number,spot:number,vol:number){
  const q=useQuery({
    queryKey:queryKeys.chain(sym,expiryDays),
    queryFn:()=>getChain(sym,expiryDays),
    select:mapChainEntries,
    refetchInterval:4000,
  });
  const t=expiryDays/365;
  const chain=useMemo(():ChainRow[]=>{
    if(q.data)return q.data;
    if(!q.isError)return[];
    // Backend unreachable — fall back to the local Black-Scholes calc
    // so the chain still renders something usable.
    return Array.from({length:21},(_,i)=>{
      const n=i-10;
      const strike=Math.round(spot*(1+n*0.04)*10000)/10000;
      const v=smileVol(vol,strike/spot);
      return{strike,call:bs(spot,strike,v,t,true),put:bs(spot,strike,v,t,false),
        itmCall:spot>strike,itmPut:spot<strike};
    });
  },[q.data,q.isError,spot,vol,t]);
  return{chain,loading:q.isLoading,error:q.error};
}
