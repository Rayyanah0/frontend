export type HotkeyAction =
  | "palette"
  | "help"
  | "tabChain"
  | "tabPositions"
  | "tabStrategies"
  | "tabSurface"
  | "prevExpiry"
  | "nextExpiry"
  | "search"
  | "buyFocused"
  | "sellFocused"
  | "jumpAtm"
  | "goPortfolio"
  | "goHistory"
  | "goOptions";

export interface HotkeyBinding {
  action: HotkeyAction;
  /** event.key (letter/symbol), case-insensitive for letters */
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const DEFAULT_BINDINGS: HotkeyBinding[] = [
  { action: "palette", key: "k", meta: true },
  { action: "palette", key: "k", ctrl: true },
  { action: "help", key: "?" },
  { action: "tabChain", key: "1" },
  { action: "tabPositions", key: "2" },
  { action: "tabStrategies", key: "3" },
  { action: "tabSurface", key: "4" },
  { action: "prevExpiry", key: "[" },
  { action: "nextExpiry", key: "]" },
  { action: "search", key: "/" },
  { action: "buyFocused", key: "b" },
  { action: "sellFocused", key: "s" },
  { action: "jumpAtm", key: "a" },
  { action: "goPortfolio", key: "p", shift: true },
  { action: "goHistory", key: "h", shift: true },
  { action: "goOptions", key: "o", shift: true },
];

const BINDINGS_KEY = "zenith.hotkeys.v1";

export function loadBindings(): HotkeyBinding[] {
  if (typeof window === "undefined") return DEFAULT_BINDINGS;
  try {
    const raw = localStorage.getItem(BINDINGS_KEY);
    if (!raw) return DEFAULT_BINDINGS;
    const parsed = JSON.parse(raw) as HotkeyBinding[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_BINDINGS;
  } catch {
    return DEFAULT_BINDINGS;
  }
}

export function saveBindings(bindings: HotkeyBinding[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
}

export function resetBindings() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(BINDINGS_KEY);
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return !!target.closest("[contenteditable='true'], input, textarea, select");
}

export function matchBinding(e: KeyboardEvent, b: HotkeyBinding): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const want = b.key.length === 1 ? b.key.toLowerCase() : b.key;
  if (key !== want) return false;
  if (!!b.ctrl !== e.ctrlKey) return false;
  if (!!b.meta !== e.metaKey) return false;
  if (!!b.alt !== e.altKey) return false;
  if (!!b.shift !== e.shiftKey) return false;
  return true;
}

export function formatBinding(b: HotkeyBinding): string {
  const parts: string[] = [];
  if (b.meta) parts.push("⌘");
  if (b.ctrl) parts.push("Ctrl");
  if (b.alt) parts.push("Alt");
  if (b.shift) parts.push("⇧");
  parts.push(b.key.length === 1 ? b.key.toUpperCase() : b.key);
  return parts.join("+");
}
