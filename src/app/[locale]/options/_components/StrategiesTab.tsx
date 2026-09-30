"use client";

import { StrategyPicker } from "../../../../components/StrategyPicker";
import { MultiLegPayoffDiagram } from "../../../../components/MultiLegPayoffDiagram";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { fmtN, fmtK } from "../../../../lib/pricing";
import { useStrategyPreview } from "./useStrategyPreview";

interface Props{sym:string;expiryDays:number;spot:number;marketVol:number;qty:number;onExecuted:()=>void;}

export function StrategiesTab(props:Props){
  const {spot}=props;
  const {selectedStrategy,setSelectedStrategy,showStrategyConfirm,setShowStrategyConfirm,tradeError,setTradeError,
    submitting,balance,pricedLegs,strategyNetPremium,strategyCollateral,strategyRequiredFunds,
    strategyInsufficientFunds,notSignedIn,execStrategy}=useStrategyPreview(props);
  return(
    <>
            <div style={{flex:1,overflowY:"auto",padding:16,display:"grid",gridTemplateColumns:"280px 1fr",gap:16}}>
              <StrategyPicker selectedId={selectedStrategy?.id??null} onSelect={setSelectedStrategy}/>

              {selectedStrategy&&(
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"var(--text-hi)",marginBottom:12}}>{selectedStrategy.name}</div>
                  {pricedLegs.map((leg,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",
                      borderBottom:"1px solid var(--border-subtle)"}}>
                      <span style={{fontSize:11,color:leg.action==="buy"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                        {leg.action} {leg.side}
                      </span>
                      <span className="num" style={{fontSize:11,color:"var(--text-mid)"}}>K={fmtK(leg.strike)}</span>
                      <span className="num" style={{fontSize:11,color:"var(--text-hi)"}}>${fmtN(leg.greeks.premium,4)}</span>
                    </div>
                  ))}
                  <div style={{display:"flex",gap:16,marginTop:10}}>
                    <div>
                      <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)"}}>
                        {strategyNetPremium>=0?"Net Debit":"Net Credit"}
                      </div>
                      <div className="num" style={{fontSize:13,fontWeight:600,color:strategyNetPremium>=0?"var(--put)":"var(--call)"}}>
                        ${fmtN(Math.abs(strategyNetPremium),2)}
                      </div>
                    </div>
                    {strategyCollateral>0&&(
                      <div>
                        <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)"}}>Collateral Required</div>
                        <div className="num" style={{fontSize:13,fontWeight:600,color:"var(--atm)"}}>${fmtN(strategyCollateral,2)}</div>
                      </div>
                    )}
                  </div>
                  <div style={{marginTop:16}}>
                    <MultiLegPayoffDiagram legs={pricedLegs} spot={spot} width={420} height={220}/>
                  </div>
                  <button onClick={()=>{setTradeError(null);setShowStrategyConfirm(true);}} disabled={strategyInsufficientFunds||notSignedIn} style={{marginTop:12,padding:"10px 20px",
                    background:"var(--brand)",color:"var(--bg)",border:"none",fontSize:13,fontWeight:700,
                    cursor:strategyInsufficientFunds||notSignedIn?"default":"pointer",opacity:strategyInsufficientFunds||notSignedIn?0.5:1}}>
                    Execute {selectedStrategy.name} ({pricedLegs.length} legs)
                  </button>
                  {strategyInsufficientFunds&&(
                    <div style={{marginTop:6,fontSize:11,color:"var(--put)"}}>
                      Insufficient balance — needs ${fmtN(strategyRequiredFunds,2)}, have ${fmtN(balance,2)}.
                    </div>
                  )}
                  {notSignedIn&&(
                    <div style={{marginTop:6,fontSize:11,color:"var(--put)"}}>
                      Connect your wallet to trade.
                    </div>
                  )}
                </div>
              )}
            </div>
      {showStrategyConfirm&&selectedStrategy&&(
        <ConfirmDialog
          title={`Execute ${selectedStrategy.name}`}
          confirmLabel={submitting?"Submitting…":"Confirm Execute"}
          onConfirm={execStrategy}
          onCancel={()=>setShowStrategyConfirm(false)}
          disabled={strategyInsufficientFunds||notSignedIn||submitting||!!tradeError}
          disabledReason={tradeError??(strategyInsufficientFunds?`Insufficient balance — needs $${fmtN(strategyRequiredFunds,2)}, have $${fmtN(balance,2)}.`:notSignedIn?"Connect your wallet to trade.":undefined)}
        >
          {pricedLegs.map((leg,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12}}>
              <span style={{color:leg.action==="buy"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>{leg.action} {leg.side}</span>
              <span className="num" style={{color:"var(--text-mid)"}}>K={fmtK(leg.strike)}</span>
              <span className="num" style={{color:"var(--text-hi)"}}>${fmtN(leg.greeks.premium*leg.contracts,2)}</span>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 0",marginTop:6,borderTop:"1px solid var(--border-default)",fontSize:12}}>
            <span style={{color:"var(--text-lo)"}}>{strategyNetPremium>=0?"Net Debit":"Net Credit"}</span>
            <span className="num" style={{color:"var(--text-hi)"}}>${fmtN(Math.abs(strategyNetPremium),2)}</span>
          </div>
          {strategyCollateral>0&&(
            <div style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12}}>
              <span style={{color:"var(--text-lo)"}}>Collateral Required</span>
              <span className="num" style={{color:"var(--text-hi)"}}>${fmtN(strategyCollateral,2)}</span>
            </div>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
