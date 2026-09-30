export const LAYOUT_VERSION = 2;

export type PanelId =
  | "chain"
  | "ticket"
  | "payoff"
  | "spotChart"
  | "volSmile"
  | "positions"
  | "alerts"
  | "surface"
  | "strategies";

export interface PanelLayoutItem {
  i: PanelId;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface WorkspaceLayout {
  version: number;
  name: string;
  panels: PanelLayoutItem[];
  /** Panels the user closed; can be re-added from the menu. */
  hidden: PanelId[];
}

export const PANEL_META: Record<PanelId, { title: string }> = {
  chain: { title: "Options Chain" },
  ticket: { title: "Order Ticket" },
  payoff: { title: "Payoff" },
  spotChart: { title: "Spot Chart" },
  volSmile: { title: "Vol Smile" },
  positions: { title: "Positions" },
  alerts: { title: "Alerts" },
  surface: { title: "Vol Surface" },
  strategies: { title: "Strategies" },
};

export const PRESET_TRADER: WorkspaceLayout = {
  version: LAYOUT_VERSION,
  name: "Trader",
  hidden: ["surface", "strategies"],
  panels: [
    { i: "spotChart", x: 0, y: 0, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "volSmile", x: 0, y: 3, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "alerts", x: 0, y: 6, w: 3, h: 3, minW: 2, minH: 2 },
    { i: "chain", x: 3, y: 0, w: 6, h: 9, minW: 4, minH: 4 },
    { i: "ticket", x: 9, y: 0, w: 3, h: 5, minW: 2, minH: 3 },
    { i: "payoff", x: 9, y: 5, w: 3, h: 4, minW: 2, minH: 2 },
    { i: "positions", x: 0, y: 9, w: 12, h: 3, minW: 4, minH: 2 },
  ],
};

export const PRESET_VOL: WorkspaceLayout = {
  version: LAYOUT_VERSION,
  name: "Vol",
  hidden: ["ticket", "payoff", "strategies", "alerts"],
  panels: [
    { i: "surface", x: 0, y: 0, w: 7, h: 7, minW: 4, minH: 4 },
    { i: "volSmile", x: 7, y: 0, w: 5, h: 4, minW: 3, minH: 2 },
    { i: "spotChart", x: 7, y: 4, w: 5, h: 3, minW: 3, minH: 2 },
    { i: "chain", x: 0, y: 7, w: 12, h: 5, minW: 4, minH: 3 },
  ],
};

export const PRESET_WRITER: WorkspaceLayout = {
  version: LAYOUT_VERSION,
  name: "Writer",
  hidden: ["surface", "volSmile", "strategies"],
  panels: [
    { i: "chain", x: 0, y: 0, w: 8, h: 8, minW: 4, minH: 4 },
    { i: "ticket", x: 8, y: 0, w: 4, h: 5, minW: 3, minH: 3 },
    { i: "alerts", x: 8, y: 5, w: 4, h: 3, minW: 2, minH: 2 },
    { i: "positions", x: 0, y: 8, w: 12, h: 4, minW: 4, minH: 2 },
    { i: "spotChart", x: 0, y: 12, w: 6, h: 3, minW: 2, minH: 2 },
    { i: "payoff", x: 6, y: 12, w: 6, h: 3, minW: 2, minH: 2 },
  ],
};

export const BUILTIN_PRESETS = [PRESET_TRADER, PRESET_VOL, PRESET_WRITER];

function storageKey(wallet: string | null) {
  return `zenith.workspace.v${LAYOUT_VERSION}.${wallet ?? "anon"}`;
}

export function migrateLayout(raw: unknown): WorkspaceLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<WorkspaceLayout> & { version?: number };
  if (!obj.panels || !Array.isArray(obj.panels) || !obj.name) return null;

  let version = obj.version ?? 1;
  let panels = obj.panels as PanelLayoutItem[];
  let hidden = (obj.hidden ?? []) as PanelId[];

  // v1 → v2: ensure min sizes and drop unknown panel ids
  if (version < 2) {
    const known = new Set(Object.keys(PANEL_META));
    panels = panels
      .filter(p => known.has(p.i))
      .map(p => ({
        ...p,
        minW: p.minW ?? 2,
        minH: p.minH ?? 2,
      }));
    hidden = hidden.filter(id => known.has(id));
    version = 2;
  }

  if (panels.length === 0) return null;
  return { version: LAYOUT_VERSION, name: String(obj.name), panels, hidden };
}

export function loadWorkspace(wallet: string | null): WorkspaceLayout {
  if (typeof window === "undefined") return PRESET_TRADER;
  try {
    const raw = localStorage.getItem(storageKey(wallet));
    if (!raw) return PRESET_TRADER;
    const migrated = migrateLayout(JSON.parse(raw));
    return migrated ?? PRESET_TRADER;
  } catch {
    return PRESET_TRADER;
  }
}

export function saveWorkspace(wallet: string | null, layout: WorkspaceLayout) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(wallet), JSON.stringify({ ...layout, version: LAYOUT_VERSION }));
}

export function listSavedLayouts(wallet: string | null): string[] {
  if (typeof window === "undefined") return [];
  try {
    const key = `zenith.workspace.saved.${wallet ?? "anon"}`;
    return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function saveNamedLayout(wallet: string | null, layout: WorkspaceLayout) {
  if (typeof window === "undefined") return;
  const key = `zenith.workspace.saved.${wallet ?? "anon"}`;
  const names = listSavedLayouts(wallet).filter(n => n !== layout.name);
  names.unshift(layout.name);
  localStorage.setItem(key, JSON.stringify(names.slice(0, 20)));
  localStorage.setItem(`${key}.${layout.name}`, JSON.stringify({ ...layout, version: LAYOUT_VERSION }));
}

export function loadNamedLayout(wallet: string | null, name: string): WorkspaceLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const key = `zenith.workspace.saved.${wallet ?? "anon"}.${name}`;
    return migrateLayout(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return null;
  }
}

export function exportLayout(layout: WorkspaceLayout): string {
  return JSON.stringify({ ...layout, version: LAYOUT_VERSION }, null, 2);
}

export function importLayout(json: string): WorkspaceLayout | null {
  try {
    return migrateLayout(JSON.parse(json));
  } catch {
    return null;
  }
}
