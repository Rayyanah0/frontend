"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette } from "./CommandPalette";
import { HotkeyHelpOverlay } from "./HotkeyHelpOverlay";
import { registerCommands } from "./registry";
import { isEditableTarget, loadBindings, matchBinding, resetBindings, type HotkeyAction } from "./hotkeys";
import { MARKETS, EXPIRIES } from "../../lib/pricing";

/**
 * Global keyboard layer + command palette. Mount once in the root layout.
 * Feature pages can register additional commands via registerCommand().
 * Options-page actions are dispatched as CustomEvents so we stay decoupled.
 */
export function CommandLayer({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const dispatchOptions = useCallback((detail: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent("zenith:options", { detail }));
  }, []);

  const handleAction = useCallback(
    (action: HotkeyAction) => {
      switch (action) {
        case "palette":
        case "search":
          setPaletteOpen(true);
          break;
        case "help":
          setHelpOpen(true);
          break;
        case "tabChain":
          dispatchOptions({ type: "tab", tab: "chain" });
          break;
        case "tabPositions":
          dispatchOptions({ type: "tab", tab: "positions" });
          break;
        case "tabStrategies":
          dispatchOptions({ type: "tab", tab: "strategies" });
          break;
        case "tabSurface":
          dispatchOptions({ type: "tab", tab: "surface" });
          break;
        case "prevExpiry":
          dispatchOptions({ type: "expiry", dir: -1 });
          break;
        case "nextExpiry":
          dispatchOptions({ type: "expiry", dir: 1 });
          break;
        case "buyFocused":
          dispatchOptions({ type: "trade", mode: "buy" });
          break;
        case "sellFocused":
          dispatchOptions({ type: "trade", mode: "write" });
          break;
        case "jumpAtm":
          dispatchOptions({ type: "jumpAtm" });
          break;
        case "goPortfolio":
          router.push("/portfolio");
          break;
        case "goHistory":
          router.push("/history");
          break;
        case "goOptions":
          router.push("/options");
          break;
      }
    },
    [dispatchOptions, router]
  );

  useEffect(() => {
    return registerCommands([
      { id: "nav.portfolio", label: "Go to Portfolio", keywords: ["go portfolio", "positions"], group: "Navigate", shortcut: "⇧P", safe: true, run: () => router.push("/portfolio") },
      { id: "nav.history", label: "Go to History", keywords: ["go history", "trades"], group: "Navigate", shortcut: "⇧H", safe: true, run: () => router.push("/history") },
      { id: "nav.options", label: "Go to Options", keywords: ["go options", "chain"], group: "Navigate", shortcut: "⇧O", safe: true, run: () => router.push("/options") },
      { id: "tab.chain", label: "Switch to Chain tab", keywords: ["toggle chain"], group: "Options", shortcut: "1", safe: true, run: () => handleAction("tabChain") },
      { id: "tab.positions", label: "Switch to Positions tab", group: "Options", shortcut: "2", safe: true, run: () => handleAction("tabPositions") },
      { id: "tab.strategies", label: "Switch to Strategies tab", group: "Options", shortcut: "3", safe: true, run: () => handleAction("tabStrategies") },
      { id: "tab.surface", label: "Toggle Surface tab", keywords: ["toggle surface", "vol surface"], group: "Options", shortcut: "4", safe: true, run: () => handleAction("tabSurface") },
      { id: "help.shortcuts", label: "Show keyboard shortcuts", keywords: ["help", "hotkeys"], group: "System", shortcut: "?", safe: true, run: () => setHelpOpen(true) },
      { id: "hotkeys.reset", label: "Reset hotkey bindings to defaults", group: "System", safe: true, run: () => { resetBindings(); } },
      ...MARKETS.flatMap(m =>
        EXPIRIES.map(e => ({
          id: `sym.${m.sym}.${e.days}`,
          label: `${m.sym} ${e.label}`,
          keywords: [m.sym.toLowerCase(), e.label.toLowerCase(), `${m.sym} ${e.days}d`],
          group: "Symbol / Expiry",
          safe: true,
          run: () => {
            router.push("/options");
            dispatchOptions({ type: "symbol", sym: m.sym, expiryDays: e.days });
          },
        }))
      ),
      { id: "trade.buyCall", label: "Buy call on focused strike", keywords: ["buy call"], group: "Trade", safe: true, run: () => dispatchOptions({ type: "trade", mode: "buy", side: "call" }) },
      { id: "trade.buyPut", label: "Buy put on focused strike", keywords: ["buy put"], group: "Trade", safe: true, run: () => dispatchOptions({ type: "trade", mode: "buy", side: "put" }) },
      { id: "trade.writeCall", label: "Write call on focused strike", keywords: ["sell call", "write call"], group: "Trade", safe: true, run: () => dispatchOptions({ type: "trade", mode: "write", side: "call" }) },
      { id: "trade.writePut", label: "Write put on focused strike", keywords: ["sell put", "write put"], group: "Trade", safe: true, run: () => dispatchOptions({ type: "trade", mode: "write", side: "put" }) },
    ]);
  }, [router, handleAction, dispatchOptions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // Don't steal keys while a dialog/palette already owns focus (except Esc handled there)
      if (paletteOpen || helpOpen) {
        if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          setPaletteOpen(v => !v);
        }
        return;
      }
      const bindings = loadBindings();
      for (const b of bindings) {
        if (!matchBinding(e, b)) continue;
        e.preventDefault();
        handleAction(b.action);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleAction, paletteOpen, helpOpen]);

  return (
    <>
      {children}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <HotkeyHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
