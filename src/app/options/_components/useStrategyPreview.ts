import { useMemo, useState } from "react";
import { ApiError } from "../../../lib/api/client";
import { useBackendData } from "../../../lib/context/BackendDataContext";
import { useWalletStore } from "../../../lib/store/wallet";
import { bs, smileVol } from "../../../lib/pricing";
import { collateralRequired } from "../../../lib/collateral";
import { netPremium, type PricedLeg } from "../../../lib/payoff";
import type { StrategyTemplate } from "../../../lib/strategies";

interface Args{sym:string;expiryDays:number;spot:number;marketVol:number;qty:number;onExecuted:()=>void;}

// Strategy leg pricing still uses the local bs()/smileVol() calc (static seed
// vol) rather than a backend round trip per leg — unchanged from before.
export function useStrategyPreview({sym,expiryDays,spot,marketVol,qty,onExecuted}:Args){
  const [selectedStrategy,setSelectedStrategy]=useState<StrategyTemplate|null>(null);
  const [showStrategyConfirm,setShowStrategyConfirm]=useState(false);
  const [tradeError,setTradeError]=useState<string|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const token=useWalletStore(s=>s.token);
  const {account,openStrategy:openBackendStrategy}=useBackendData();
  const balance=account?.balance ?? 0;
  const t=expiryDays/365;

  const pricedLegs=useMemo(():PricedLeg[]=>{
    if(!selectedStrategy)return[];
    return selectedStrategy.legs.map(leg=>{
      const strike=Math.round(spot*leg.strikeOffset*10000)/10000;
      const legVol=smileVol(marketVol,leg.strikeOffset);
      const greeks=bs(spot,strike,legVol,t,leg.side==="call");
      return{side:leg.side,action:leg.action,strike,contracts:qty,greeks};
    });
  },[selectedStrategy,spot,marketVol,t,qty]);

  const strategyNetPremium=useMemo(()=>netPremium(pricedLegs),[pricedLegs]);
  const strategyCollateral=useMemo(()=>pricedLegs.reduce((sum,leg)=>
    leg.action==="sell"?sum+collateralRequired(leg.side,leg.contracts,leg.strike,spot):sum,0
  ),[pricedLegs,spot]);
  const strategyRequiredFunds=strategyCollateral+Math.max(0,strategyNetPremium);
  const strategyInsufficientFunds=pricedLegs.length>0&&balance<strategyRequiredFunds;
  const notSignedIn=!token;

  const execStrategy=async()=>{
    if(!selectedStrategy||pricedLegs.length===0||strategyInsufficientFunds||submitting)return;
    setSubmitting(true);
    setTradeError(null);
    try{
      await openBackendStrategy(pricedLegs.map(leg=>({
        underlying:sym,strike:leg.strike,expiryDays,
        optionType:leg.side,positionType:leg.action==="buy"?"long":"short",contracts:leg.contracts,
      })));
      setSelectedStrategy(null);
      setShowStrategyConfirm(false);
      onExecuted();
    }catch(err){
      setTradeError(err instanceof ApiError?err.message:"Failed to execute strategy");
    }finally{
      setSubmitting(false);
    }
  };
  return{selectedStrategy,setSelectedStrategy,showStrategyConfirm,setShowStrategyConfirm,tradeError,setTradeError,
    submitting,balance,pricedLegs,strategyNetPremium,strategyCollateral,strategyRequiredFunds,
    strategyInsufficientFunds,notSignedIn,execStrategy};
}
