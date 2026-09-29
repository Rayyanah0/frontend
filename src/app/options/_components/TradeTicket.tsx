"use client";

import { PayoffDiagram } from "../../../components/PayoffDiagram";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { fmtN, fmtK } from "../../../lib/pricing";
import { useTradeTicket } from "./useTradeTicket";
import type { Expiry, TradeState } from "./types";

interface Props{trade:TradeState|null;sym:string;expiry:Expiry;spot:number;
  contracts:string;setContracts:(f:string|((c:string)=>string))=>void;
  onClose:()=>void;onExecuted:()=>void;}

export function TradeTicket({trade,sym,expiry,spot,contracts,setContracts,onClose,onExecuted}:Props){
  const {showTradeConfirm,setShowTradeConfirm,tradeError,setTradeError,submitting,balance,qty,
    tradeGreeks,collateral,insufficientFunds,notSignedIn,execTrade}=
    useTradeTicket({trade,sym,expiry,spot,contracts,onDone:onExecuted});
  if(!trade||!tradeGreeks)return null;
  return(
    <>
          <aside style={{width:316,flexShrink:0,borderLeft:"1px solid var(--border-default)",
            overflowY:"auto",background:"var(--bg-raised)",display:"flex",flexDirection:"column"}}>

            <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border-default)",
              display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.1em",
                  color:trade.side==="call"?"var(--call)":"var(--put)",marginBottom:4}}>
                  {trade.mode==="write"?"WRITE ":"BUY "}{trade.side==="call"?"▲ CALL":"▼ PUT"}
                </div>
                <div style={{fontSize:15,fontWeight:700,color:"var(--text-hi)"}}>
                  {sym} {trade.side==="call"?"Call":"Put"}
                </div>
                <div className="num" style={{fontSize:12,color:"var(--text-mid)"}}>
                  K={fmtK(trade.row.strike)} · {expiry.label}
                </div>
              </div>
              <button onClick={()=>onClose()} style={{background:"none",border:"none",
                color:"var(--text-lo)",fontSize:18,cursor:"pointer",lineHeight:1,padding:4}}>×</button>
            </div>

            {/* Payoff diagram */}
            <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border-default)"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",
                color:"var(--text-lo)",marginBottom:8}}>P&L at Expiry</div>
              <PayoffDiagram
                spot={spot} strike={trade.row.strike} premium={tradeGreeks.premium}
                isCall={trade.side==="call"} short={trade.mode==="write"} contracts={qty}
                width={284} height={155}
              />
            </div>

            {/* Greeks grid */}
            <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border-default)"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",
                color:"var(--text-lo)",marginBottom:10}}>Option Greeks</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[{g:"Δ Delta",v:tradeGreeks.delta,dp:3,c:"var(--brand)"},
                  {g:"Γ Gamma",v:tradeGreeks.gamma,dp:4,c:"var(--text-hi)"},
                  {g:"Θ Theta",v:tradeGreeks.theta,dp:4,c:"var(--put)"},
                  {g:"V Vega", v:tradeGreeks.vega, dp:3,c:"var(--atm)"},
                ].map(item=>(
                  <div key={item.g} style={{padding:"9px 10px",borderRadius:0,
                    border:"1px solid var(--border-default)",background:"var(--bg-elevated)"}}>
                    <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",
                      color:"var(--text-lo)",marginBottom:4}}>{item.g}</div>
                    <div className="num" style={{fontSize:14,fontWeight:600,color:item.c}}>
                      {item.v>=0?"+":"\u2212"}{Math.abs(item.v).toFixed(item.dp)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:6,marginTop:6}}>
                {[{label:"Premium",v:`$${fmtN(tradeGreeks.premium)}`,c:"var(--text-hi)"},
                  {label:"Impl. Vol",v:`${(tradeGreeks.iv*100).toFixed(1)}%`,c:"var(--brand)"},
                ].map(item=>(
                  <div key={item.label} style={{flex:1,padding:"9px 10px",borderRadius:0,
                    border:"1px solid var(--border-default)",background:"var(--bg-elevated)"}}>
                    <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:"0.08em",
                      color:"var(--text-lo)",marginBottom:4}}>{item.label}</div>
                    <div className="num" style={{fontSize:14,fontWeight:600,color:item.c}}>{item.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Order entry */}
            <div style={{padding:"14px 16px",borderBottom:"1px solid var(--border-default)"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",
                color:"var(--text-lo)",marginBottom:8}}>Order</div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:10,color:"var(--text-lo)",marginBottom:4}}>Contracts</div>
                <div style={{display:"flex",alignItems:"center",
                  background:"var(--bg-overlay)",border:"1px solid var(--border-default)",
                  borderRadius:0,overflow:"hidden"}}>
                  <button onClick={()=>setContracts(c=>String(Math.max(0.01,(parseFloat(c)||1)-1)))}
                    style={{width:36,height:40,border:"none",background:"none",color:"var(--text-mid)",fontSize:18,cursor:"pointer"}}>−</button>
                  <input type="number" min="0.01" step="0.01" value={contracts}
                    onChange={e=>setContracts(e.target.value)}
                    onBlur={e=>setContracts(String(Math.max(0.01,parseFloat(e.target.value)||1)))}
                    style={{flex:1,height:40,border:"none",background:"none",textAlign:"center",
                      fontFamily:"var(--font-mono)",fontSize:16,color:"var(--text-hi)",outline:"none"}}/>
                  <button onClick={()=>setContracts(c=>String((parseFloat(c)||0)+1))}
                    style={{width:36,height:40,border:"none",background:"none",color:"var(--text-mid)",fontSize:18,cursor:"pointer"}}>+</button>
                </div>
              </div>
              <div style={{background:"var(--bg-elevated)",borderRadius:0,padding:"9px 12px",marginBottom:10}}>
                {(trade.mode==="write"?[
                  ["Qty",`${contracts} × ${sym}`],
                  ["Premium received",`+$${fmtN(tradeGreeks.premium*qty)}`],
                  ["Collateral required",`$${fmtN(collateral)}`],
                  ["Available balance",`$${fmtN(balance,2)}`],
                ]:[
                  ["Qty",`${contracts} × ${sym}`],
                  ["Total premium",`$${fmtN(tradeGreeks.premium*qty)}`],
                  ["Max loss",`$${fmtN(tradeGreeks.premium*qty)}`],
                  ["Available balance",`$${fmtN(balance,2)}`],
                ]).map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"3px 0"}}>
                    <span style={{fontSize:11,color:"var(--text-lo)"}}>{k}</span>
                    <span className="num" style={{fontSize:11,
                      color:k==="Premium received"?"var(--call)":"var(--text-hi)"}}>{v}</span>
                  </div>
                ))}
                {insufficientFunds&&(
                  <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid var(--border-default)",
                    fontSize:11,color:"var(--put)"}}>
                    Insufficient balance {trade.mode==="write"?"to post collateral":"to cover premium"}.
                  </div>
                )}
                {notSignedIn&&(
                  <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid var(--border-default)",
                    fontSize:11,color:"var(--put)"}}>
                    Connect your wallet to trade.
                  </div>
                )}
                {tradeError&&(
                  <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid var(--border-default)",
                    fontSize:11,color:"var(--put)"}}>
                    {tradeError}
                  </div>
                )}
              </div>
              <button onClick={()=>{setTradeError(null);setShowTradeConfirm(true);}} disabled={insufficientFunds||notSignedIn} style={{width:"100%",height:44,borderRadius:0,border:"none",
                cursor:insufficientFunds||notSignedIn?"default":"pointer",fontSize:14,fontWeight:700,
                opacity:insufficientFunds||notSignedIn?0.5:1,
                background:trade.side==="call"?"var(--call)":"var(--put)",color:"var(--bg)"}}>
                {trade.mode==="write"?"Write":"Buy"} {trade.side.toUpperCase()} @ {fmtK(trade.row.strike)}
              </button>
            </div>

            <div style={{padding:"14px 16px"}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)",marginBottom:8}}>
                Strategies using this strike
              </div>
              {(trade.side==="call"
                ?["Covered Call — sell this call against stock","Bull Call Spread — buy this, sell higher strike","Long Call — pure directional bet"]
                :["Protective Put — hedge long exposure","Bear Put Spread — buy this, sell lower strike","Cash-Secured Put — sell this for income"]
              ).map(s=>(
                <div key={s} style={{padding:"7px 0",borderBottom:"1px solid var(--border-subtle)",fontSize:11,color:"var(--text-mid)",cursor:"pointer",transition:"color 100ms"}}
                  onMouseOver={e=>{(e.currentTarget as HTMLElement).style.color="var(--text-hi)"}}
                  onMouseOut={e=>{(e.currentTarget as HTMLElement).style.color="var(--text-mid)"}}>
                  → {s}
                </div>
              ))}
            </div>
          </aside>
        <ConfirmDialog
          title={`${trade.mode==="write"?"Write":"Buy"} ${sym} ${trade.side.toUpperCase()}`}
          confirmLabel={submitting?"Submitting…":`Confirm ${trade.mode==="write"?"Write":"Buy"}`}
          onConfirm={execTrade}
          onCancel={()=>setShowTradeConfirm(false)}
          disabled={insufficientFunds||notSignedIn||submitting||!!tradeError}
          disabledReason={tradeError??(insufficientFunds?`Insufficient balance ${trade.mode==="write"?"to post collateral":"to cover premium"}.`:undefined)}
        >
          {[
            ["Strike",fmtK(trade.row.strike)],
            ["Expiry",expiry.label],
            ["Contracts",String(qty)],
            [trade.mode==="write"?"Premium received":"Total premium",`$${fmtN(tradeGreeks.premium*qty,2)}`],
            ...(trade.mode==="write"?[["Collateral required",`$${fmtN(collateral,2)}`]]:[]),
          ].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",fontSize:12}}>
              <span style={{color:"var(--text-lo)"}}>{k}</span>
              <span className="num" style={{color:"var(--text-hi)"}}>{v}</span>
            </div>
          ))}
        </ConfirmDialog>
    </>
  );
}
