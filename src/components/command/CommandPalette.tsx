"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Command as CmdkRoot, CommandInput, CommandList, CommandEmpty, CommandItem, CommandGroup } from "cmdk";
import {
  getCommands,
  searchCommands,
  subscribeCommands,
  pushRecentCommand,
  loadRecentCommandIds,
  type Command,
} from "./registry";

function useCommandList() {
  return useSyncExternalStore(subscribeCommands, getCommands, () => [] as Command[]);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const all = useCommandList();
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setRecentIds(loadRecentCommandIds());
    }
  }, [open]);

  const results = useMemo(() => searchCommands(query, all), [query, all]);
  const recent = useMemo(
    () => recentIds.map(id => all.find(c => c.id === id)).filter(Boolean) as Command[],
    [recentIds, all]
  );

  const run = useCallback(
    (cmd: Command) => {
      pushRecentCommand(cmd.id);
      onOpenChange(false);
      cmd.run();
    },
    [onOpenChange]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const groups = new Map<string, Command[]>();
  for (const c of results) {
    const g = c.group ?? "Commands";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => onOpenChange(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "92vw", background: "var(--bg-elevated)",
          border: "1px solid var(--border-default)", boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
        }}
      >
        <CmdkRoot label="Command palette" shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search commands… e.g. BTC 30D, go portfolio, toggle surface"
            style={{
              width: "100%", padding: "14px 16px", border: "none", borderBottom: "1px solid var(--border-default)",
              background: "transparent", color: "var(--text-hi)", fontSize: 14, outline: "none",
              fontFamily: "var(--font-sans)",
            }}
          />
          <CommandList style={{ maxHeight: 360, overflowY: "auto", padding: 6 }}>
            <CommandEmpty style={{ padding: 16, fontSize: 12, color: "var(--text-lo)" }}>No matching commands</CommandEmpty>
            {!query && recent.length > 0 && (
              <CommandGroup heading="Recent">
                {recent.map(c => (
                  <CommandItem
                    key={`r-${c.id}`}
                    value={c.id}
                    onSelect={() => run(c)}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 10px", fontSize: 13, color: "var(--text-hi)", cursor: "pointer",
                      borderRadius: 0,
                    }}
                  >
                    <span>{c.label}</span>
                    {c.shortcut && <kbd style={{ fontSize: 10, color: "var(--text-lo)" }}>{c.shortcut}</kbd>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {Array.from(groups.entries()).map(([heading, cmds]) => (
              <CommandGroup key={heading} heading={heading}>
                {cmds.map(c => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => run(c)}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 10px", fontSize: 13, color: "var(--text-hi)", cursor: "pointer",
                    }}
                  >
                    <span>{c.label}</span>
                    {c.shortcut && <kbd style={{ fontSize: 10, color: "var(--text-lo)" }}>{c.shortcut}</kbd>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </CmdkRoot>
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border-subtle)", fontSize: 10, color: "var(--text-lo)" }}>
          ↑↓ navigate · Enter run · Esc close · ? shortcuts · trades always require confirm
        </div>
      </div>
    </div>
  );
}
