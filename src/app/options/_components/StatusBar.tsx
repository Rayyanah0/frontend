export function StatusBar({strikes}:{strikes:number}){
  const chain={length:strikes};
  return(
      <div style={{height:26,flexShrink:0,borderTop:"1px solid var(--border-subtle)",
        display:"flex",alignItems:"center",gap:16,padding:"0 16px",background:"var(--bg)"}}>
        <span style={{fontSize:10,color:"var(--text-lo)"}}>
          Black-Scholes · r=5.0% · Vol smile applied · {chain.length} strikes
        </span>
        <span style={{fontSize:10,color:"var(--text-lo)"}}>·</span>
        <span style={{fontSize:10,color:"var(--text-lo)"}}>Click an <b>ask</b> to buy, a <b>bid</b> to write (sell) and collect premium</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:"var(--call)",opacity:0.8}}/>
          <span style={{fontSize:10,color:"var(--text-lo)"}}>Live · Stellar Testnet</span>
        </div>
      </div>
  );
}
