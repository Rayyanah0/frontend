export type CommandId = string;

export interface Command {
  id: CommandId;
  label: string;
  keywords?: string[];
  group?: string;
  shortcut?: string;
  /** When true, the command only navigates / opens UI — never submits a trade. */
  safe: boolean;
  run: () => void;
}

type Listener = () => void;

const commands = new Map<CommandId, Command>();
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach(l => l());
}

export function registerCommand(cmd: Command) {
  commands.set(cmd.id, cmd);
  emit();
  return () => {
    commands.delete(cmd.id);
    emit();
  };
}

export function registerCommands(cmds: Command[]) {
  const unsubs = cmds.map(registerCommand);
  return () => unsubs.forEach(u => u());
}

export function getCommands(): Command[] {
  return Array.from(commands.values());
}

export function subscribeCommands(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Simple fuzzy score: subsequence match with bonus for consecutive chars. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      streak++;
      score += 1 + streak;
      qi++;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : 0;
}

export function searchCommands(query: string, list: Command[] = getCommands()): Command[] {
  if (!query.trim()) return list;
  return list
    .map(c => {
      const hay = [c.label, ...(c.keywords ?? []), c.group ?? ""].join(" ");
      return { c, score: fuzzyScore(query, hay) };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.c);
}

const RECENT_KEY = "zenith.commands.recent.v1";
const MAX_RECENT = 8;

export function loadRecentCommandIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function pushRecentCommand(id: string) {
  if (typeof window === "undefined") return;
  const prev = loadRecentCommandIds().filter(x => x !== id);
  localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...prev].slice(0, MAX_RECENT)));
}
