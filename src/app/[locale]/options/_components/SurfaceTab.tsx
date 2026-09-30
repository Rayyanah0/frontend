"use client";

import { VolSurfaceHeatmap } from "../../../../components/VolSurfaceHeatmap";

export function SurfaceTab({vol,expiryDays}:{vol:number;expiryDays:number}){
  return(
            <div style={{flex:1,overflowY:"auto",padding:16}}>
              <VolSurfaceHeatmap baseVol={vol} selectedExpiryDays={expiryDays}/>
            </div>
  );
}
