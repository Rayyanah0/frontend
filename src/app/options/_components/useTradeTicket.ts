import { useState } from "react";
import { ApiError } from "../../../lib/api/client";
import { useBackendData } from "../../../lib/context/BackendDataContext";
import { useWalletStore } from "../../../lib/store/wallet";
import { collateralRequired } from "../../../lib/collateral";
import type { Expiry, TradeState } from "./types";

interface Args{trade:TradeState|null;sym:string;expiry:Expiry;spot:number;contracts:string;onDone:()=>void;}

// Validation, collateral and funds checks + submit for the single-leg ticket.
export function useTradeTicket({trade,sym,expiry,spot,contracts,onDone}:Args){
  const [showTradeConfirm,setShowTradeConfirm]=useState(false);
  const [tradeError,setTradeError]=useState<string|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const token=useWalletStore(s=>s.token);
  const {account,open:openBackendPosition}=useBackendData();
  const balance=account?.balance ?? 0;
  const qty=Math.max(0.01,parseFloat(contracts)||1);
  const tradeGreeks=trade?(trade.side==="call"?trade.row.call:trade.row.put):null;
  const collateral=trade&&trade.mode==="write"?collateralRequired(trade.side,qty,trade.row.strike,spot):0;
  const requiredFunds=trade?(trade.mode==="write"?collateral:(tradeGreeks?.premium??0)*qty):0;
  const insufficientFunds=balance<requiredFunds;
  const notSignedIn=!token;

  const execTrade=async()=>{
    if(!trade||!tradeGreeks||insufficientFunds||submitting)return;
    setSubmitting(true);
    setTradeError(null);
    try{
      await openBackendPosition({
        underlying:sym,strike:trade.row.strike,expiryDays:expiry.days,
        optionType:trade.side,positionType:trade.mode==="write"?"short":"long",contracts:qty,
      });
      setShowTradeConfirm(false);
      onDone();
    }catch(err){
      setTradeError(err instanceof ApiError?err.message:"Failed to open position");
    }finally{
      setSubmitting(false);
    }
  };
  return{showTradeConfirm,setShowTradeConfirm,tradeError,setTradeError,submitting,balance,qty,
    tradeGreeks,collateral,insufficientFunds,notSignedIn,execTrade};
}
