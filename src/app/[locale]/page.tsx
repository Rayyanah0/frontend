"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "../../i18n/navigation";
import { PayoffDiagram } from "../../components/PayoffDiagram";
import { Logo } from "../../components/Logo";
import { bs, smileVol, fmtN, fmtK, MARKETS } from "../../lib/pricing";
import { ProvenanceBadge } from "../../components/FeedStatus";
import { useBackendData } from "../../lib/context/BackendDataContext";
import { useSpotFeedContext } from "../../lib/context/SpotFeedContext";
import { getChain } from "../../lib/api/market";
import type { OptionChainEntry } from "../../lib/api/types";

const XLMPRICE=0.1182, XLMVOL=0.82, T=30/365;

export default function Home() {
  const t = useTranslations("home");
  const tNav = useTranslations("nav");
  const previewRef=useRef<HTMLElement>(null);
  const { data:feed, status:feedStatus } = useSpotFeedContext(previewRef);
  // Server + first client render use the static seed (no hydration mismatch);
  // live values replace it once the shared feed delivers a message.
  const live = feed!==null && feedStatus==="open";
  const spot=feed?.prices.XLM ?? XLMPRICE;
  const xlmVol=feed?.vols.XLM ?? XLMVOL;
  const { watchlist } = useBackendData();
  const favMarkets=MARKETS.filter(m=>watchlist.some(w=>w.underlying===m.sym));

  // Backend chain rows (keyed by strike offset) once live; local BS fallback otherwise.
  const [backendChain,setBackendChain]=useState<OptionChainEntry[]|null>(null);
  useEffect(()=>{
    if(!live) return;
    let cancelled=false;
    getChain("XLM",30).then(e=>{if(!cancelled)setBackendChain(e)}).catch(()=>{});
    return()=>{cancelled=true};
  },[live]);

  const previewChain=useMemo(()=>{
    if(live&&backendChain&&backendChain.length>=5){
      const mid=backendChain.reduce((bi,e,i,arr)=>Math.abs(e.strike-spot)<Math.abs(arr[bi].strike-spot)?i:bi,0);
      const start=Math.max(0,Math.min(backendChain.length-5,mid-2));
      return backendChain.slice(start,start+5).map(e=>({strike:e.strike,call:e.call,put:e.put,itm:e.is_itm_call}));
    }
    const strikes=[spot*0.90,spot*0.95,spot,spot*1.05,spot*1.10];
    return strikes.map(K=>{
      const vol=smileVol(xlmVol,K/spot);
      return{strike:K,call:bs(spot,K,vol,T,true),put:bs(spot,K,vol,T,false),itm:spot>K};
    });
  },[spot,xlmVol,live,backendChain]);

  return (
    <div style={{fontFamily:"var(--font-sans)",background:"var(--bg)",minHeight:"100vh",color:"var(--text-hi)"}}>

      {/* NAV */}
      <nav style={{position:"sticky",top:0,zIndex:50,height:52,display:"flex",alignItems:"center",
        justifyContent:"space-between",padding:"0 24px",
        borderBottom:"1px solid var(--border-default)",background:"rgba(20,19,15,0.88)",backdropFilter:"blur(12px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:32}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Logo size={18} />
            <span style={{fontSize:14,fontWeight:600,letterSpacing:"0",fontFamily:"var(--font-serif)"}}>Zenith</span>
          </div>
          <div className="nav-links">
            {[[tNav("optionsChain"),"/options"],[tNav("portfolio"),"/portfolio"],[tNav("docs"),"#"]].map(([l,h])=>(
              <Link key={l} href={h} style={{fontSize:13,color:"var(--text-mid)",textDecoration:"none",
                transition:"color 120ms"}}
                onMouseOver={e=>{(e.target as HTMLElement).style.color="var(--text-hi)"}}
                onMouseOut={e=>{(e.target as HTMLElement).style.color="var(--text-mid)"}}>
                {l}
              </Link>
            ))}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"var(--call)"}}/>
            <span style={{fontSize:11,color:"var(--text-lo)"}}>{t("network")}</span>
          </div>
          <Link href="/options" style={{padding:"7px 14px",background:"var(--brand)",color:"var(--bg)",
            border:"none",borderRadius:0,fontSize:13,fontWeight:700,cursor:"pointer",textDecoration:"none"}}>
            {tNav("tradeOptions")}
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section style={{maxWidth:1080,margin:"0 auto",padding:"80px 24px 48px"}}>
        <div className="hero-grid">
          <div>
            <div style={{fontSize:11,fontFamily:"var(--font-mono)",color:"var(--brand)",
              textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:20}}>
              {t("eyebrow")}
            </div>

            <h1 style={{fontFamily:"var(--font-serif)",fontSize:"clamp(2.4rem,4.2vw,3.5rem)",fontWeight:600,
              letterSpacing:"-0.01em",lineHeight:1.08,marginBottom:20}}>
              {t.rich("headline", { br: () => <br/> })}
            </h1>

            <p style={{fontSize:16,color:"var(--text-mid)",lineHeight:1.65,maxWidth:440,marginBottom:32}}>
              {t("intro")}
            </p>

            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:48}}>
              <Link href="/options" style={{padding:"11px 22px",background:"var(--brand)",color:"var(--bg)",
                borderRadius:0,fontWeight:700,fontSize:14,cursor:"pointer",textDecoration:"none"}}>
                {t("openChain")}
              </Link>
              <a href="https://github.com/Zenith-options" style={{padding:"11px 22px",
                border:"1px solid var(--border-strong)",color:"var(--text-mid)",
                borderRadius:0,fontWeight:500,fontSize:14,cursor:"pointer",textDecoration:"none"}}>
                {t("viewGithub")}
              </a>
            </div>

            {/* Stats — plain, no cards */}
            <div className="stats-row">
              {[["$2.2M",t("stats.openInterest")],["84",t("stats.activeSeries")],["312",t("stats.traders")],["25%",t("stats.avgIv")]].map(([v,l],i)=>(
                <div key={l} style={{paddingRight:32,marginRight:32,
                  borderRight:i<3?"1px solid var(--border-subtle)":"none"}}>
                  <div className="num" style={{fontSize:22,fontWeight:700,color:"var(--text-hi)",marginBottom:2}}>{v}</div>
                  <div style={{fontSize:11,color:"var(--text-lo)",textTransform:"uppercase",letterSpacing:"0.06em"}}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: payoff diagram showcase */}
          <div>
            <div style={{marginBottom:12}}>
              <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-lo)"}}>
                {t("example", { strike: fmtK(spot*1.05) })}
              </span>
            </div>
            <div style={{padding:20,background:"var(--bg-raised)",border:"1px solid var(--border-default)",borderRadius:0}}>
              <PayoffDiagram
                spot={spot} strike={spot*1.05}
                premium={bs(spot,spot*1.05,smileVol(xlmVol,1.05),T,true).premium}
                isCall={true} contracts={100}
                width={380} height={200}
              />
            </div>
            <div style={{display:"flex",gap:16,marginTop:12,justifyContent:"center"}}>
              {[
                {dot:"var(--call)",label:t("profitZone")},
                {dot:"var(--put)",label:t("maxLoss")},
              ].map(item=>(
                <div key={item.label} style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:8,height:8,borderRadius:0,background:item.dot}}/>
                  <span style={{fontSize:11,color:"var(--text-lo)"}}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* LIVE CHAIN PREVIEW */}
      <section ref={previewRef} style={{maxWidth:1080,margin:"0 auto",padding:"0 24px 64px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-lo)",marginBottom:4}}>
              {t("livePreview")}
            </div>
            <h2 style={{fontFamily:"var(--font-serif)",fontSize:19,fontWeight:600}}>{t("chainTitle")}</h2>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:live?"var(--call)":"var(--text-lo)"}}/>
            <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-lo)"}}>
              {live?t("live"):t("staticSnapshot")}
            </span>
            <span className="num" style={{fontSize:14,fontWeight:600}}>{fmtK(spot)}</span> <ProvenanceBadge source="seed"/>
            <Link href="/options" style={{padding:"6px 14px",border:"1px solid var(--border-strong)",
              borderRadius:0,fontSize:12,color:"var(--text-mid)",textDecoration:"none",
              transition:"color 120ms"}}
              onMouseOver={e=>{(e.currentTarget as HTMLElement).style.color="var(--text-hi)"}}
              onMouseOut={e=>{(e.currentTarget as HTMLElement).style.color="var(--text-mid)"}}>
              {t("fullChain")}
            </Link>
          </div>
        </div>

        <div style={{border:"1px solid var(--border-default)",borderRadius:0,overflow:"hidden",background:"var(--bg-raised)"}}>
          {/* Chain header */}
          <div style={{display:"grid",gridTemplateColumns:"52px 60px 68px 68px 48px 88px 48px 68px 68px 60px 52px",
            padding:"0",borderBottom:"1px solid var(--border-default)",background:"var(--bg-overlay)"}}>
            {(["vol","oi","bid","ask","iv","strike","iv","ask","bid","oi","vol"] as const).map(k=>t(`columns.${k}`)).map((h,i)=>(
              <div key={i} style={{padding:"6px 6px",fontSize:10,fontWeight:500,textTransform:"uppercase",
                letterSpacing:"0.05em",textAlign:i===5?"center":"right",
                color:i<5?"rgba(92,154,107,0.6)":i===5?"var(--text-lo)":"rgba(182,86,64,0.6)"}}>
                {h}
              </div>
            ))}
          </div>

          {previewChain.map((row,i)=>{
            const isAtm=i===2;
            const sp=Math.max(0.00001,row.call.premium*0.003);
            return(
              <div key={i} style={{display:"grid",
                gridTemplateColumns:"52px 60px 68px 68px 48px 88px 48px 68px 68px 60px 52px",
                height:28,alignItems:"center",
                borderBottom:"1px solid var(--border-subtle)",
                background:isAtm?"var(--atm-dim)":row.itm?"rgba(92,154,107,0.05)":"transparent"}}>
                {[80,320,fmtN(Math.max(0,row.call.premium-sp)),fmtN(row.call.premium+sp),`${(row.call.iv*100).toFixed(1)}`].map((v,j)=>(
                  <div key={j} className="num" style={{fontSize:11,textAlign:"right",padding:"0 6px",
                    color:j===3?"var(--call)":j===4?"var(--brand)":"var(--text-mid)"}}>{v}</div>
                ))}
                <div style={{fontSize:11,fontWeight:700,textAlign:"center",padding:"0 6px",fontFamily:"var(--font-mono)",
                  color:isAtm?"var(--atm)":"var(--text-mid)"}}>
                  {fmtK(row.strike)}{isAtm&&<span style={{fontSize:8,marginLeft:3,opacity:0.6}}>{t("atm")}</span>}
                </div>
                {[`${(row.put.iv*100).toFixed(1)}`,fmtN(row.put.premium+sp),fmtN(Math.max(0,row.put.premium-sp)),320,80].map((v,j)=>(
                  <div key={j} className="num" style={{fontSize:11,textAlign:"right",padding:"0 6px",
                    color:j===0?"var(--brand)":j===1?"var(--put)":"var(--text-mid)"}}>{v}</div>
                ))}
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:12}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:10,height:10,borderRadius:0,background:"var(--call-dim)",border:"1px solid rgba(92,154,107,0.35)"}}/>
            <span style={{fontSize:11,color:"var(--text-lo)"}}>{t("itmCall")}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:10,height:10,borderRadius:0,background:"var(--atm-dim)",border:"1px solid rgba(181,150,101,0.35)"}}/>
            <span style={{fontSize:11,color:"var(--text-lo)"}}>{t("atmStrike")}</span>
          </div>
          <div style={{fontSize:11,color:"var(--text-lo)"}}>{t("clickToTrade")}</div>
        </div>
      </section>

      {/* WATCHLIST */}
      <section style={{maxWidth:1080,margin:"0 auto",padding:"0 24px 64px"}}>
        <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-lo)",marginBottom:8}}>
          {t("watchlist")}
        </div>
        {favMarkets.length===0 ? (
          <p style={{fontSize:13,color:"var(--text-mid)"}}>
            {t.rich("watchlistEmpty", { link: (chunks) => <Link href="/options" style={{color:"var(--brand)"}}>{chunks}</Link> })}
          </p>
        ) : (
          <div style={{display:"flex",gap:0,border:"1px solid var(--border-default)",background:"var(--bg-raised)"}}>
            {favMarkets.map((m,i)=>(
              <Link key={m.sym} href={`/options?u=${m.sym}`} style={{flex:1,padding:"14px 18px",textDecoration:"none",
                borderRight:i<favMarkets.length-1?"1px solid var(--border-default)":"none"}}>
                <div style={{fontSize:12,fontWeight:600,color:"var(--text-hi)",marginBottom:4}}>{m.sym}</div>
                <div className="num" style={{fontSize:15,fontWeight:600,color:"var(--text-hi)"}}>{fmtK(m.sym==="XLM"?spot:(feed?.prices[m.sym]??m.price))}</div>
                <div style={{fontSize:10,color:"var(--text-lo)"}}>{t("ivValue", { value: `${Math.round(m.vol*100)}%` })}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* HOW IT WORKS — no cards, just structured text */}
      <section style={{maxWidth:1080,margin:"0 auto",padding:"0 24px 80px"}}>
        <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-lo)",marginBottom:8}}>
          {t("protocol")}
        </div>
        <h2 style={{fontFamily:"var(--font-serif)",fontSize:26,fontWeight:600,letterSpacing:"-0.01em",marginBottom:40}}>{t("howItWorks")}</h2>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1px",background:"var(--border-default)",border:"1px solid var(--border-default)"}}>
          {[
            {n:"01",color:"var(--call)",rgb:"92,154,107",key:"buyer"},
            {n:"02",color:"var(--brand)",rgb:"181,150,101",key:"writer"},
            {n:"03",color:"var(--atm)",rgb:"181,150,101",key:"pricing"},
            {n:"04",color:"var(--put)",rgb:"182,86,64",key:"settlement"},
          ].map(({key,...rest})=>({...rest,side:t(`steps.${key}.side`),title:t(`steps.${key}.title`),body:t(`steps.${key}.body`)})).map(item=>(
            <div key={item.n} style={{padding:"24px 28px",background:"var(--bg-raised)"}}>
              <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
                <span style={{fontSize:11,fontFamily:"var(--font-mono)",color:item.color}}>{item.n}</span>
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:0,fontWeight:600,
                  background:`rgba(${item.rgb},0.12)`,
                  color:item.color,textTransform:"uppercase",letterSpacing:"0.08em"}}>
                  {item.side}
                </span>
              </div>
              <div style={{fontSize:14,fontWeight:600,marginBottom:8}}>{item.title}</div>
              <p style={{fontSize:13,color:"var(--text-mid)",lineHeight:1.6}}>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{borderTop:"1px solid var(--border-subtle)",padding:"20px 24px"}}>
        <div style={{maxWidth:1080,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:12,color:"var(--text-lo)"}}>{t("footer")}</span>
          <div style={{display:"flex",gap:20}}>
            {[["GitHub","https://github.com/Zenith-options"],[t("discord"),"#"],[tNav("docs"),"#"]].map(([l,href])=>(
              <a key={l} href={href} style={{fontSize:12,color:"var(--text-lo)",textDecoration:"none",
                transition:"color 120ms"}}
                onMouseOver={e=>{(e.target as HTMLElement).style.color="var(--text-hi)"}}
                onMouseOut={e=>{(e.target as HTMLElement).style.color="var(--text-lo)"}}>
                {l}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
