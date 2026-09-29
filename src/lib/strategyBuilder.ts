// Pure reducer for the free-form N-leg strategy builder (#32).
import { STRATEGY_TEMPLATES, type StrategyTemplate } from "./strategies";

export const MAX_LEGS = 8;
export const MIN_QTY_STEP = 0.01;

export interface BuilderLeg {
  id: string;
  side: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  quantity: number;
  expiryDays: number;
}

export interface BuilderState {
  name: string;
  templateId: string | null;
  legs: BuilderLeg[];
}

export type BuilderAction =
  | { type: "applyTemplate"; template: StrategyTemplate; spot: number; expiryDays: number; quantity: number; strikes: number[] }
  | { type: "addLeg"; leg?: Partial<BuilderLeg>; spot: number; expiryDays: number; strikes: number[] }
  | { type: "updateLeg"; id: string; patch: Partial<Omit<BuilderLeg, "id">> }
  | { type: "removeLeg"; id: string }
  | { type: "setStrike"; id: string; strike: number }
  | { type: "setName"; name: string }
  | { type: "load"; state: BuilderState }
  | { type: "clear" };

function uid() {
  return `leg-${Math.random().toString(36).slice(2, 9)}`;
}

/** Snap a raw strike to the nearest listed chain strike. */
export function snapStrike(raw: number, strikes: number[]): number {
  if (strikes.length === 0) return raw;
  let best = strikes[0];
  let bestDist = Math.abs(raw - best);
  for (const s of strikes) {
    const d = Math.abs(raw - s);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}

export function nearestStrike(spot: number, offset: number, strikes: number[]): number {
  return snapStrike(spot * offset, strikes);
}

export function stepStrike(current: number, strikes: number[], direction: 1 | -1): number {
  if (strikes.length === 0) return current;
  const sorted = [...strikes].sort((a, b) => a - b);
  const idx = sorted.findIndex(s => Math.abs(s - current) < 1e-9);
  if (idx < 0) {
    const snapped = snapStrike(current, sorted);
    const si = sorted.indexOf(snapped);
    const next = si + direction;
    return sorted[Math.max(0, Math.min(sorted.length - 1, next))];
  }
  const next = idx + direction;
  return sorted[Math.max(0, Math.min(sorted.length - 1, next))];
}

export function validateLeg(leg: BuilderLeg, strikes: number[]): string | null {
  if (leg.quantity < MIN_QTY_STEP) return `Quantity must be ≥ ${MIN_QTY_STEP}`;
  if (strikes.length > 0 && !strikes.some(s => Math.abs(s - leg.strike) < 1e-9)) {
    return "Strike must exist in the chain";
  }
  return null;
}

export function validateBuilder(state: BuilderState, strikes: number[]): string[] {
  const errs: string[] = [];
  if (state.legs.length === 0) errs.push("Add at least one leg");
  if (state.legs.length > MAX_LEGS) errs.push(`At most ${MAX_LEGS} legs`);
  for (const leg of state.legs) {
    const e = validateLeg(leg, strikes);
    if (e) errs.push(`Leg ${leg.side} K=${leg.strike}: ${e}`);
  }
  return errs;
}

export function emptyBuilder(name = "Custom"): BuilderState {
  return { name, templateId: null, legs: [] };
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case "applyTemplate": {
      const legs = action.template.legs.slice(0, MAX_LEGS).map(l => ({
        id: uid(),
        side: l.side,
        action: l.action,
        strike: nearestStrike(action.spot, l.strikeOffset, action.strikes),
        quantity: action.quantity,
        expiryDays: action.expiryDays,
      }));
      return { name: action.template.name, templateId: action.template.id, legs };
    }
    case "addLeg": {
      if (state.legs.length >= MAX_LEGS) return state;
      const atm = nearestStrike(action.spot, 1, action.strikes);
      const leg: BuilderLeg = {
        id: uid(),
        side: "call",
        action: "buy",
        strike: atm,
        quantity: 1,
        expiryDays: action.expiryDays,
        ...action.leg,
      };
      return { ...state, templateId: null, legs: [...state.legs, leg] };
    }
    case "updateLeg":
      return {
        ...state,
        templateId: null,
        legs: state.legs.map(l => (l.id === action.id ? { ...l, ...action.patch } : l)),
      };
    case "setStrike":
      return {
        ...state,
        templateId: null,
        legs: state.legs.map(l => (l.id === action.id ? { ...l, strike: action.strike } : l)),
      };
    case "removeLeg":
      return { ...state, templateId: null, legs: state.legs.filter(l => l.id !== action.id) };
    case "setName":
      return { ...state, name: action.name };
    case "load":
      return action.state;
    case "clear":
      return emptyBuilder();
    default:
      return state;
  }
}

const STORAGE_KEY = "zenith-custom-strategies";

export interface SavedStrategy {
  name: string;
  savedAt: string;
  legs: Omit<BuilderLeg, "id">[];
}

export function listSavedStrategies(): SavedStrategy[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedStrategy[]) : [];
  } catch {
    return [];
  }
}

export function saveStrategy(name: string, legs: BuilderLeg[]): SavedStrategy[] {
  const entry: SavedStrategy = {
    name,
    savedAt: new Date().toISOString(),
    legs: legs.map(({ side, action, strike, quantity, expiryDays }) => ({
      side, action, strike, quantity, expiryDays,
    })),
  };
  const all = listSavedStrategies().filter(s => s.name !== name);
  all.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return all;
}

export function deleteSavedStrategy(name: string): SavedStrategy[] {
  const all = listSavedStrategies().filter(s => s.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return all;
}

export function exportStrategiesJson(strategies: SavedStrategy[]): string {
  return JSON.stringify(strategies, null, 2);
}

export function importStrategiesJson(json: string): SavedStrategy[] {
  const parsed = JSON.parse(json) as SavedStrategy[];
  if (!Array.isArray(parsed)) throw new Error("Expected an array of strategies");
  const existing = listSavedStrategies();
  const byName = new Map(existing.map(s => [s.name, s]));
  for (const s of parsed) {
    if (!s.name || !Array.isArray(s.legs)) continue;
    byName.set(s.name, s);
  }
  const merged = Array.from(byName.values());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function templateById(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find(t => t.id === id);
}
