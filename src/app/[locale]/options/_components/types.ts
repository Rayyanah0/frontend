import type { Greeks, MARKETS, EXPIRIES } from "../../../../lib/pricing";

export interface ChainRow{strike:number;call:Greeks;put:Greeks;itmCall:boolean;itmPut:boolean;}
export interface TradeState{row:ChainRow;side:"call"|"put";mode:"buy"|"write";}
export type Market=(typeof MARKETS)[number];
export type Expiry=(typeof EXPIRIES)[number];
export type ViewTab="chain"|"positions"|"strategies"|"surface";
