"use client";

import Link from "next/link";
import { AppHeader } from "../../../components/AppHeader";
import { WalletConnect } from "../../../components/WalletConnect";
import { useBackendHistory } from "../../../lib/hooks/useBackendHistory";
import { useWalletStore } from "../../../lib/store/wallet";
import { useHydrated } from "../../../lib/useHydrated";
import { fmtN, fmtK } from "../../../lib/pricing";
import { toCsv, downloadCsv } from "../../../lib/csv";
import { ExportButton } from "../../../components/ExportButton";
import { ExpandableCard } from "../../../components/ExpandableCard";
import { useIsCompact } from "../../../lib/useMediaQuery";
import { PerformanceAnalytics } from "../../../components/PerformanceAnalytics";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function HistoryPage() {
  const isCompact = useIsCompact();
  const hydrated = useHydrated();
  const token = useWalletStore(s => s.session);
  const { trades, stats } = useBackendHistory(hydrated ? token : null);

  return (
    <div className="zn-shell" style={{display:"flex",flexDirection:"column",background:"var(--bg)",overflow:"hidden",fontFamily:"var(--font-sans)"}}>
      <AppHeader>
        <div style={{marginLeft:"auto"}}>
          <WalletConnect />
        </div>
      </AppHeader>

      <div style={{flex:1,overflowY:"auto"}}>
        <div className="zn-page" style={{maxWidth:1080,margin:"0 auto",padding:"32px 24px 64px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <h1 className="zn-page-title" style={{fontFamily:"var(--font-serif)",fontSize:26,fontWeight:600,marginBottom:4}}>Trade History</h1>
              <p style={{fontSize:13,color:"var(--text-mid)",marginBottom:28}}>
                {!token ? "Connect your wallet to see your trade history." : `${trades.length} closed trade${trades.length===1?"":"s"}`}
              </p>
            </div>
            {trades.length>0 && (
              <ExportButton onClick={()=>downloadCsv(
                `zenith-history-${new Date().toISOString().slice(0,10)}.csv`,
                toCsv(trades,[
                  {header:"Opened",value:r=>r.opened_at},
                  {header:"Closed",value:r=>r.closed_at??""},
                  {header:"Asset",value:r=>r.underlying},
                  {header:"Type",value:r=>r.position_type},
                  {header:"Side",value:r=>r.option_type},
                  {header:"Status",value:r=>r.status},
                  {header:"Strike",value:r=>r.strike},
                  {header:"Expiry Days",value:r=>r.expiry_days},
                  {header:"Qty",value:r=>r.contracts},
                  {header:"Entry Premium",value:r=>r.entry_premium},
                  {header:"Close Premium",value:r=>r.close_premium??""},
                  {header:"Realized P&L",value:r=>r.realized_pnl??""},
                ])
              )}/>
            )}
          </div>

          {stats.trade_count>0 && (
            <div className="zn-stat-strip zn-stat-strip--trio" style={{marginBottom:24}}>
              {[
                {label:"Closed Trades", value:String(stats.trade_count), color:"var(--text-hi)"},
                {label:"Total Realized P&L", value:`${stats.total_realized_pnl>=0?"+":"−"}$${fmtN(Math.abs(stats.total_realized_pnl),2)}`, color:stats.total_realized_pnl>=0?"var(--call)":"var(--put)"},
                {label:"Win Rate", value:`${stats.trade_count>0?((stats.win_count/stats.trade_count)*100).toFixed(0):"0"}%`, color:"var(--atm)"},
              ].map((s)=>(
                <div key={s.label} className="zn-stat-cell">
                  <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)",marginBottom:6}}>{s.label}</div>
                  <div className="num" style={{fontSize:17,fontWeight:600,color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {trades.length>0 && <PerformanceAnalytics trades={trades} />}

          {trades.length===0 ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              padding:"80px 0",border:"1px solid var(--border-subtle)",background:"var(--bg-raised)",gap:12}}>
              <div style={{fontSize:14,color:"var(--text-mid)"}}>No trades yet</div>
              <Link href="/options" style={{fontSize:13,color:"var(--brand)",textDecoration:"none"}}>
                Open the options chain →
              </Link>
            </div>
          ) : isCompact ? (
            <div style={{display:"flex",flexDirection:"column"}}>
              {trades.map(r=>{
                const pnlFormatted = r.realized_pnl===null ? "—" : `${r.realized_pnl>=0?"+":"−"}$${fmtN(Math.abs(r.realized_pnl),2)}`;
                const pnlColor = r.realized_pnl===null ? "var(--text-lo)" : r.realized_pnl>=0 ? "var(--call)" : "var(--put)";
                return (
                  <ExpandableCard
                    key={r.id}
                    title={
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:13,fontWeight:600,color:"var(--text-hi)"}}>{r.underlying}</span>
                        <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                          background:r.position_type==="short"?"var(--put-dim)":"var(--call-dim)",
                          color:r.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                          {r.position_type}
                        </span>
                        <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                          background:r.option_type==="call"?"var(--call-dim)":"var(--put-dim)",
                          color:r.option_type==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                          {r.option_type}
                        </span>
                      </div>
                    }
                    subtitle={
                      <span className="num">
                        K={fmtK(r.strike)} · {r.expiry_days}D · {r.contracts}×
                      </span>
                    }
                    trailing={
                      <div style={{textAlign:"right"}}>
                        <div className="num" style={{fontSize:13,fontWeight:600,color:pnlColor}}>
                          {pnlFormatted}
                        </div>
                        <div style={{fontSize:10,color:"var(--text-mid)",textTransform:"capitalize"}}>
                          {r.status}
                        </div>
                      </div>
                    }
                    details={
                      <>
                        <div className="zn-kv">
                          <span style={{color:"var(--text-lo)"}}>Closed At</span>
                          <span style={{color:"var(--text-hi)",fontSize:11}}>{fmtDate(r.closed_at)}</span>
                        </div>
                        <div className="zn-kv">
                          <span style={{color:"var(--text-lo)"}}>Status</span>
                          <span style={{color:"var(--text-hi)",fontSize:11,textTransform:"capitalize"}}>{r.status}</span>
                        </div>
                        <div className="zn-kv">
                          <span style={{color:"var(--text-lo)"}}>Strike</span>
                          <span className="num" style={{color:"var(--text-hi)"}}>{fmtK(r.strike)}</span>
                        </div>
                        <div className="zn-kv">
                          <span style={{color:"var(--text-lo)"}}>Entry Premium</span>
                          <span className="num" style={{color:"var(--text-mid)"}}>
                            ${fmtN(r.entry_premium*r.contracts,2)}
                          </span>
                        </div>
                        <div className="zn-kv">
                          <span style={{color:"var(--text-lo)"}}>Close Premium</span>
                          <span className="num" style={{color:"var(--text-hi)"}}>
                            {r.close_premium===null?"—":`$${fmtN(r.close_premium*r.contracts,2)}`}
                          </span>
                        </div>
                        <div className="zn-kv">
                          <span style={{color:"var(--text-lo)"}}>Realized P&L</span>
                          <span className="num" style={{color:pnlColor,fontWeight:600}}>
                            {pnlFormatted}
                          </span>
                        </div>
                      </>
                    }
                  />
                );
              })}
            </div>
          ) : (
            <div style={{border:"1px solid var(--border-default)",background:"var(--bg-raised)",overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
                <thead>
                  <tr style={{borderBottom:"1px solid var(--border-default)"}}>
                    {["Closed","Asset","Type","Side","Status","Strike","Expiry","Qty","Entry","Close","Realized P&L"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",fontSize:10,fontWeight:500,textTransform:"uppercase",
                        letterSpacing:"0.05em",color:"var(--text-lo)",textAlign:"right",background:"var(--bg-overlay)"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map(r=>(
                    <tr key={r.id} style={{borderBottom:"1px solid var(--border-subtle)"}}>
                      <td style={{padding:"8px 10px",fontSize:11,color:"var(--text-mid)"}}>{fmtDate(r.closed_at)}</td>
                      <td style={{padding:"8px 10px",fontSize:12,fontWeight:600,color:"var(--text-hi)"}}>{r.underlying}</td>
                      <td style={{padding:"8px 10px"}}>
                        <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                          background:r.position_type==="short"?"var(--put-dim)":"var(--call-dim)",
                          color:r.position_type==="short"?"var(--put)":"var(--call)",textTransform:"uppercase"}}>
                          {r.position_type}
                        </span>
                      </td>
                      <td style={{padding:"8px 10px"}}>
                        <span style={{fontSize:10,fontWeight:600,padding:"2px 6px",
                          background:r.option_type==="call"?"var(--call-dim)":"var(--put-dim)",
                          color:r.option_type==="call"?"var(--call)":"var(--put)",textTransform:"uppercase"}}>
                          {r.option_type}
                        </span>
                      </td>
                      <td style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-mid)",textTransform:"capitalize"}}>{r.status}</td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{fmtK(r.strike)}</td>
                      <td style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-mid)"}}>{r.expiry_days}D</td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>{r.contracts}</td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>${fmtN(r.entry_premium*r.contracts,2)}</td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",color:"var(--text-hi)"}}>
                        {r.close_premium===null?"—":`$${fmtN(r.close_premium*r.contracts,2)}`}
                      </td>
                      <td className="num" style={{padding:"8px 10px",fontSize:11,textAlign:"right",fontWeight:600,
                        color:r.realized_pnl===null?"var(--text-lo)":r.realized_pnl>=0?"var(--call)":"var(--put)"}}>
                        {r.realized_pnl===null?"—":`${r.realized_pnl>=0?"+":"−"}$${fmtN(Math.abs(r.realized_pnl),2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
