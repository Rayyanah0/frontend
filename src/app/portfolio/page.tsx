"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../../components/AppHeader";
import { WalletConnect } from "../../components/WalletConnect";
import { useBackendData } from "../../lib/context/BackendDataContext";
import { useSpotFeedContext } from "../../lib/context/SpotFeedContext";
import { useWalletStore } from "../../lib/store/wallet";
import { ApiError } from "../../lib/api/client";
import type { Position } from "../../lib/api/types";
import { MARKETS, EXPIRIES, bs, smileVol, fmtN, fmtK } from "../../lib/pricing";
import { collateralRequired } from "../../lib/collateral";
import { toCsv, downloadCsv } from "../../lib/csv";
import { ExportButton } from "../../components/ExportButton";
// PortfolioRiskPanel renders a heavy canvas chart — load lazily to keep
// the portfolio page's initial JS lean (Issue #108 bundle optimization).
import { PortfolioRiskPanelLazy as PortfolioRiskPanel } from "../../components/lazy";
import { RulesPanel } from "../../components/RulesPanel";
import type { MarkedPosition } from "../../lib/managementRules";
import { useLivePnL, type LivePosition } from "../../lib/hooks/useLivePnL";
import { GreekExposurePanel } from "../../components/GreekExposurePanel";
import { SorobanHealthIndicator } from "../../components/SorobanHealthIndicator";
import { AccountReadinessChecklist } from "../../components/AccountReadinessChecklist";
import { ReconciliationPanel } from "../../components/ReconciliationPanel";
import { DepositWithdrawModal } from "../../components/DepositWithdrawModal";
import { useNetworkReady } from "../../lib/hooks/useNetworkReady";

// Keep Marked as an alias for LivePosition so downstream code is unchanged
type Marked = LivePosition;

export default function PortfolioPage() {
  const token = useWalletStore(s => s.token);
  const { account, positions: backendPositions, greeks: netGreeks, close, roll } = useBackendData();
  const balance = account?.balance ?? 0;
  const collateralLocked = account?.collateral_locked ?? 0;
  const notSignedIn = !token;
  const networkReady = useNetworkReady();
  const canSign = networkReady && !notSignedIn;
  const [actionError, setActionError] = useState<string|null>(null);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [vaultModalMode, setVaultModalMode] = useState<"deposit"|"withdraw">("deposit");

  // Live from the shared WebSocket feed (SpotFeedProvider) — one
  // connection covers every underlying, so marking every open position
  // to market doesn't need its own per-symbol subscription or poll.
  const { data: spotFeed } = useSpotFeedContext();
  const spots = spotFeed?.prices ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.price]));
  const vols = spotFeed?.vols ?? Object.fromEntries(MARKETS.map(m => [m.sym, m.vol]));

  // Live P&L streaming — throttled to 4 Hz max, flash animations on
  // changed cells, and an aria-live announcement cadence for screen readers.
  const { marked, totalPnl, announcementSummary } = useLivePnL(backendPositions, spotFeed);

  const strategyGroups = useMemo(() => {
    const byId = new Map<string, Marked[]>();
    for (const p of marked) {
      if (!p.strategy_id) continue;
      if (!byId.has(p.strategy_id)) byId.set(p.strategy_id, []);
      byId.get(p.strategy_id)!.push(p);
    }
    return Array.from(byId.entries()).map(([id, legs]) => ({
      id, legs,
      sym: legs[0].underlying,
      totalPnl: legs.reduce((s, l) => s + l.pnl, 0),
      totalCollateral: legs.reduce((s, l) => s + l.collateral, 0),
    }));
  }, [marked]);

  const soloPositions = useMemo(() => marked.filter(p => !p.strategy_id), [marked]);

  // Realize the position's P&L into the account balance and release any
  // collateral, then remove it. This is the one place a position actually
  // settles — the quick view on the chain page just links here.
  const handleClose = async (p: Marked) => {
    setActionError(null);
    try {
      await close(p.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to close position");
    }
  };

  const handleCloseStrategy = async (legs: Marked[]) => {
    setActionError(null);
    try {
      for (const leg of legs) await close(leg.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to close strategy");
    }
  };

  const [rollTargetId, setRollTargetId] = useState<string|null>(null);
  const rollTarget = soloPositions.find(p => p.id === rollTargetId) ?? null;
  const [rollStrikeOffsetPct, setRollStrikeOffsetPct] = useState(0);
  const [rollExpiry, setRollExpiry] = useState(EXPIRIES[2]);

  useEffect(() => {
    if (!rollTarget) return;
    setRollStrikeOffsetPct(0);
    setRollExpiry(EXPIRIES.find(e => e.days === rollTarget.expiry_days) ?? EXPIRIES[2]);
  }, [rollTargetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rollPreview = useMemo(() => {
    if (!rollTarget) return null;
    const spot = spots[rollTarget.underlying] ?? MARKETS.find(m => m.sym === rollTarget.underlying)?.price ?? 0;
    const baseVol = vols[rollTarget.underlying] ?? MARKETS.find(m => m.sym === rollTarget.underlying)?.vol ?? 0.5;
    const newStrike = Math.round(rollTarget.strike * (1 + rollStrikeOffsetPct / 100) * 10000) / 10000;
    const t = rollExpiry.days / 365;
    const vol = smileVol(baseVol, newStrike / spot);
    const greeks = bs(spot, newStrike, vol, t, rollTarget.option_type === "call");
    const newPremium = greeks.premium * rollTarget.contracts;
    const newCollateral = rollTarget.position_type === "short"
      ? collateralRequired(rollTarget.option_type, rollTarget.contracts, newStrike, spot) : 0;

    // Same cash math as handleClose (old leg) + open (new leg), just summed
    // into one net figure instead of applied as two separate trades. This
    // is a client-side estimate only — the backend computes the real
    // numbers atomically when Confirm Roll is actually clicked.
    const closeCashEffect = rollTarget.position_type === "short"
      ? rollTarget.collateral - rollTarget.currentPremium
      : rollTarget.currentPremium;
    const openCashEffect = rollTarget.position_type === "short"
      ? newPremium - newCollateral
      : -newPremium;
    const netCashEffect = closeCashEffect + openCashEffect;

    return { spot, newStrike, greeks, newPremium, newCollateral, closeCashEffect, netCashEffect };
  }, [rollTarget, rollStrikeOffsetPct, rollExpiry, spots, vols]);

  // After releasing the old leg's collateral and settling its P&L, does the
  // resulting balance actually cover what opening the new leg needs? Just a
  // preview check — the backend is the final authority when Confirm Roll runs.
  const rollInsufficientFunds = rollTarget && rollPreview
    ? balance + rollPreview.closeCashEffect < (rollTarget.position_type === "short" ? rollPreview.newCollateral : rollPreview.newPremium)
    : false;

  const [rolling, setRolling] = useState(false);
  const executeRoll = async () => {
    if (!rollTarget || !rollPreview || rollInsufficientFunds || rolling) return;
    setRolling(true);
    setActionError(null);
    try {
      await roll(rollTarget.id, { newStrike: rollPreview.newStrike, newExpiryDays: rollExpiry.days });
      setRollTargetId(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Failed to roll position");
    } finally {
      setRolling(false);
    }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"var(--bg)",overflow:"hidden",fontFamily:"var(--font-sans)"}}>
      <AppHeader>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <SorobanHealthIndicator />
          <div style={{width:1,height:16,background:"var(--border-default)",margin:"0 4px"}}/>
          <div style={{width:5,height:5,borderRadius:"50%",background:"var(--call)"}}/>
          <span style={{fontSize:10,color:"var(--text-lo)"}}>Marked to market · Stellar Testnet</span>
          <div style={{width:1,height:16,background:"var(--border-default)",margin:"0 8px"}}/>
          <button
            onClick={()=>{setVaultModalMode("deposit");setShowVaultModal(true);}}
            aria-label="Deposit collateral"
            style={{padding:"4px 10px",fontSize:11,fontWeight:700,background:"var(--call-dim)",color:"var(--call)",border:"1px solid var(--call)",cursor:"pointer"}}>
            Deposit
          </button>
          <button
            onClick={()=>{setVaultModalMode("withdraw");setShowVaultModal(true);}}
            aria-label="Withdraw collateral"
            style={{padding:"4px 10px",fontSize:11,fontWeight:700,background:"var(--bg-overlay)",color:"var(--text-mid)",border:"1px solid var(--border-default)",cursor:"pointer"}}>
            Withdraw
          </button>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{flex:1,overflowY:"auto"}}>
        {/* Screen-reader-only live region: announced at most every 30s or on significant P&L change */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            position:"absolute",width:1,height:1,padding:0,margin:-1,
            overflow:"hidden",clip:"rect(0,0,0,0)",whiteSpace:"nowrap",border:0,
          }}
        >
          {announcementSummary}
        </div>

        <div style={{maxWidth:1080,margin:"0 auto",padding:"32px 24px 64px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <h1 style={{fontFamily:"var(--font-serif)",fontSize:26,fontWeight:600,marginBottom:4}}>Portfolio</h1>
              <p style={{fontSize:13,color:"var(--text-mid)",marginBottom:28}}>
                {notSignedIn
                  ? "Connect your wallet to see your positions."
                  : `${backendPositions.length} open position${backendPositions.length===1?"":"s"} · live premium repriced off current spot`}
              </p>
            </div>
            {marked.length>0 && (
              <ExportButton onClick={()=>downloadCsv(
                `zenith-positions-${new Date().toISOString().slice(0,10)}.csv`,
                toCsv(marked,[
                  {header:"Asset",value:p=>p.underlying},
                  {header:"Type",value:p=>p.position_type},
                  {header:"Side",value:p=>p.option_type},
                  {header:"Strike",value:p=>p.strike},
                  {header:"Expiry",value:p=>`${p.expiry_days}D`},
                  {header:"Qty",value:p=>p.contracts},
                  {header:"Strategy",value:p=>p.strategy_id??""},
                  {header:"Collateral",value:p=>p.collateral},
                  {header:"Entry Premium",value:p=>p.entry_premium*p.contracts},
                  {header:"Current Value",value:p=>p.currentPremium},
                  {header:"P&L",value:p=>p.pnl},
                ])
              )}/>
            )}
          </div>

          {/* Summary bar */}
          <div style={{display:"flex",gap:0,marginBottom:32,border:"1px solid var(--border-default)",background:"var(--bg-raised)"}}>
            {[
              {label:"Available Balance", value:`$${fmtN(balance,2)}`, color:"var(--text-hi)"},
              {label:"Collateral Locked", value:`$${fmtN(collateralLocked,2)}`, color:"var(--atm)"},
              {label:"Unrealized P&L", value:`${totalPnl>=0?"+":"−"}$${fmtN(Math.abs(totalPnl),2)}`, color:totalPnl>=0?"var(--call)":"var(--put)"},
              {label:"Net Delta", value:`${netGreeks.delta>=0?"+":"−"}${Math.abs(netGreeks.delta).toFixed(3)}`, color:"var(--text-hi)"},
              {label:"Net Theta", value:`${netGreeks.theta>=0?"+":"−"}${Math.abs(netGreeks.theta).toFixed(4)}`, color:"var(--put)"},
              {label:"Net Vega", value:`${netGreeks.vega>=0?"+":"−"}${Math.abs(netGreeks.vega).toFixed(3)}`, color:"var(--atm)"},
            ].map((s,i)=>(
              <div key={s.label} style={{flex:1,padding:"14px 18px",borderRight:i<5?"1px solid var(--border-default)":"none"}}>
                <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)",marginBottom:6}}>{s.label}</div>
                <div className="num" style={{fontSize:17,fontWeight:600,color:s.color}}>{s.value}</div>
              </div>
            ))}
          </div>

          {actionError && (
            <div style={{marginBottom:16,padding:"10px 14px",border:"1px solid var(--put)",background:"var(--put-dim)",fontSize:12,color:"var(--put)"}}>
              {actionError}
            </div>
          )}

          {backendPositions.length>0 && <PortfolioRiskPanel positions={backendPositions} spots={spots} />}
          {backendPositions.length>0 && (
            <GreekExposurePanel
              positions={backendPositions}
              spots={spots}
              vols={vols}
              backendGreeks={netGreeks}
            />
          )}

          {/* On-chain readiness & reconciliation — shown when wallet is connected */}
          {!notSignedIn && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
              <AccountReadinessChecklist />
              <ReconciliationPanel positions={backendPositions} />
            </div>
          )}

          {/* Management Rules — persisted per wallet, evaluated live against marked positions */}
          {token && account && marked.length>0 && (
            <div style={{marginBottom:24}}>
              <RulesPanel
                positions={marked as MarkedPosition[]}
                walletAddress={account.wallet_address}
                onExecuteRule={async (alert) => {
                  // Translate rule action into the appropriate portfolio operation.
                  // Roll variants (roll_out, roll_up, roll_down) will be wired to the
                  // actual roll API once the rule action model is expanded — for now
                  // they fall through to close so the confirmation flow still works.
                  setActionError(null);
                  try {
                    await close(alert.positionId);
                  } catch (err) {
                    setActionError(err instanceof ApiError ? err.message : "Failed to execute rule");
                  }
                }}
              />
            </div>
          )}

          {strategyGroups.length>0 && (
            <div style={{marginBottom:24,display:"flex",flexDirection:"column",gap:8}}>
              {strategyGroups.map(g=>(
                <div key={g.id} style={{border:"1px solid var(--border-default)",background:"var(--bg-raised)",padding:"12px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{g.sym} Strategy · {g.legs.length} legs</div>
                    <button onClick={()=>handleCloseStrategy(g.legs)} style={{
                      fontSize:10,color:"var(--text-lo)",background:"none",border:"1px solid var(--border-default)",
                      padding:"2px 8px",cursor:"pointer"}}>Close all legs</button>
                  </div>
                  {g.legs.map(leg=>(
                    <div key={leg.id} style={{display:"flex",justifyContent:"space-between",padding:"2px 0",fontSize:11}}>
                      <span style={{color:leg.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                        {leg.position_type} {leg.option_type}
                      </span>
                      <span className="num" style={{color:"var(--text-mid)"}}>K={leg.strike.toFixed(4)}</span>
                      <span className="num" style={{color:leg.pnl>=0?"var(--call)":"var(--put)"}}>
                        {leg.pnl>=0?"+":"−"}${fmtN(Math.abs(leg.pnl),2)}
                      </span>
                    </div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:"1px solid var(--border-subtle)"}}>
                    <span style={{fontSize:11,color:"var(--text-lo)"}}>
                      {g.totalCollateral>0?`Collateral: $${fmtN(g.totalCollateral,2)}`:""}
                    </span>
                    <span className="num" style={{fontSize:12,fontWeight:600,color:g.totalPnl>=0?"var(--call)":"var(--put)"}}>
                      Combined: {g.totalPnl>=0?"+":"−"}${fmtN(Math.abs(g.totalPnl),2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {marked.length===0 ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              padding:"80px 0",border:"1px solid var(--border-subtle)",background:"var(--bg-raised)",gap:12}}>
              <div style={{fontSize:14,color:"var(--text-mid)"}}>No open positions</div>
              <Link href="/options" style={{fontSize:13,color:"var(--brand)",textDecoration:"none"}}>
                Open the options chain →
              </Link>
            </div>
          ) : soloPositions.length===0 ? null : (
            <div style={{border:"1px solid var(--border-default)",background:"var(--bg-raised)",overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:940}}>
                <thead>
                  <tr style={{borderBottom:"1px solid var(--border-default)"}}>
                    {["Asset","Type","Side","Strike","Expiry","Qty","Collateral","Entry","Current","P&L","Δ",""].map(h=>(
                      <th key={h} style={{padding:"8px 10px",fontSize:10,fontWeight:500,textTransform:"uppercase",
                        letterSpacing:"0.05em",color:"var(--text-lo)",textAlign:"right",background:"var(--bg-overlay)"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {soloPositions.map(p=>{
                    const sign = p.position_type==="short"?-1:1;
                    return [
                      <tr key={p.id} style={{borderBottom:"1px solid var(--border-subtle)"}}>
                        <td style={{padding:"10px",fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{p.underlying}</td>
                        <td style={{padding:"10px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                            background:p.position_type==="short"?"var(--put-dim)":"var(--call-dim)",
                            color:p.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                            {p.position_type}
                          </span>
                        </td>
                        <td style={{padding:"10px 4px"}}>
                          <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                            background:p.option_type==="call"?"var(--call-dim)":"var(--put-dim)",
                            color:p.option_type==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                            {p.option_type}
                          </span>
                        </td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{p.strike>=1000?p.strike.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):p.strike.toFixed(4)}</td>
                        <td style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{p.expiry_days}D</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{p.contracts}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{p.collateral>0?`$${fmtN(p.collateral,2)}`:"—"}</td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>
                          {p.position_type==="short"?"+":""}${fmtN(p.entry_premium*p.contracts,2)}
                        </td>
                        <td className={`num${p.premiumFlash==="up"?" flash-up":p.premiumFlash==="down"?" flash-down":""}`} style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>${fmtN(p.currentPremium,2)}</td>
                        <td className={`num${p.pnlFlash==="up"?" flash-up":p.pnlFlash==="down"?" flash-down":""}`} style={{padding:"10px",fontSize:11,textAlign:"right",fontWeight:600,color:p.pnl>=0?"var(--call)":"var(--put)"}}>
                          {p.pnl>=0?"+":"−"}${fmtN(Math.abs(p.pnl),2)} <span style={{opacity:0.6}}>({p.pnlPct>=0?"+":""}{p.pnlPct.toFixed(1)}%)</span>
                        </td>
                        <td className="num" style={{padding:"10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{(sign*p.liveDelta*p.contracts).toFixed(3)}</td>
                        <td style={{padding:"6px 10px",textAlign:"right",whiteSpace:"nowrap"}}>
                          <button onClick={()=>setRollTargetId(rollTargetId===p.id?null:p.id)} disabled={notSignedIn} style={{
                            fontSize:10,color:rollTargetId===p.id?"var(--brand)":"var(--text-lo)",background:"none",
                            border:"1px solid var(--border-default)",padding:"2px 8px",cursor:notSignedIn?"default":"pointer",marginRight:6,opacity:notSignedIn?0.5:1}}>
                            Roll
                          </button>
                          <button onClick={()=>handleClose(p)} disabled={notSignedIn} style={{
                            fontSize:10,color:"var(--text-lo)",background:"none",border:"1px solid var(--border-default)",
                            padding:"2px 8px",cursor:notSignedIn?"default":"pointer",opacity:notSignedIn?0.5:1}}>
                            {p.position_type==="short"?"Buy to close":"Sell to close"}
                          </button>
                        </td>
                      </tr>,
                      rollTargetId===p.id && (
                        <tr key={`${p.id}-roll`} style={{borderBottom:"1px solid var(--border-subtle)",background:"var(--bg-elevated)"}}>
                          <td colSpan={11} style={{padding:"12px 16px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                              <div>
                                <div style={{fontSize:10,color:"var(--text-lo)",marginBottom:4}}>New Strike</div>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <button onClick={()=>setRollStrikeOffsetPct(v=>v-5)} style={{
                                    background:"var(--bg-overlay)",border:"1px solid var(--border-default)",
                                    color:"var(--text-mid)",padding:"3px 8px",cursor:"pointer"}}>−5%</button>
                                  <span className="num" style={{fontSize:12,color:"var(--text-hi)",minWidth:70,textAlign:"center"}}>
                                    {fmtK(p.strike*(1+rollStrikeOffsetPct/100))}
                                  </span>
                                  <button onClick={()=>setRollStrikeOffsetPct(v=>v+5)} style={{
                                    background:"var(--bg-overlay)",border:"1px solid var(--border-default)",
                                    color:"var(--text-mid)",padding:"3px 8px",cursor:"pointer"}}>+5%</button>
                                </div>
                              </div>
                              <div>
                                <div style={{fontSize:10,color:"var(--text-lo)",marginBottom:4}}>New Expiry</div>
                                <div style={{display:"flex",gap:2}}>
                                  {EXPIRIES.map(e=>(
                                    <button key={e.label} onClick={()=>setRollExpiry(e)} style={{
                                      padding:"3px 7px",border:"none",cursor:"pointer",fontSize:11,
                                      background:rollExpiry.label===e.label?"var(--atm-dim)":"transparent",
                                      color:rollExpiry.label===e.label?"var(--atm)":"var(--text-lo)"}}>{e.label}</button>
                                  ))}
                                </div>
                              </div>
                              {rollPreview && (
                                <>
                                  <div>
                                    <div style={{fontSize:10,color:"var(--text-lo)",marginBottom:4}}>New Premium</div>
                                    <span className="num" style={{fontSize:13,fontWeight:600,color:"var(--text-hi)"}}>
                                      ${fmtN(rollPreview.newPremium,2)}
                                    </span>
                                  </div>
                                  <div>
                                    <div style={{fontSize:10,color:"var(--text-lo)",marginBottom:4}}>
                                      {rollPreview.netCashEffect>=0?"Net Credit":"Net Cost"}
                                    </div>
                                    <span className="num" style={{fontSize:13,fontWeight:600,
                                      color:rollPreview.netCashEffect>=0?"var(--call)":"var(--put)"}}>
                                      ${fmtN(Math.abs(rollPreview.netCashEffect),2)}
                                    </span>
                                  </div>
                                </>
                              )}
                              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
                                {rollInsufficientFunds && (
                                  <span style={{fontSize:11,color:"var(--put)"}}>Insufficient balance for the new leg</span>
                                )}
                                <button onClick={()=>setRollTargetId(null)} style={{
                                  fontSize:11,color:"var(--text-lo)",background:"none",
                                  border:"1px solid var(--border-default)",padding:"5px 12px",cursor:"pointer"}}>Cancel</button>
                                <button onClick={executeRoll} disabled={!!rollInsufficientFunds||rolling} style={{
                                  fontSize:11,color:"var(--bg)",background:"var(--brand)",border:"none",
                                  padding:"5px 12px",cursor:rollInsufficientFunds||rolling?"default":"pointer",
                                  opacity:rollInsufficientFunds||rolling?0.5:1}}>{rolling?"Rolling…":"Confirm Roll"}</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showVaultModal && (
        <DepositWithdrawModal
          initialMode={vaultModalMode}
          onClose={()=>setShowVaultModal(false)}
        />
      )}
    </div>
  );
}
