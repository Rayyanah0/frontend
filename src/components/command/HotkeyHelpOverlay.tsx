"use client";

import { DEFAULT_BINDINGS, formatBinding, loadBindings, type HotkeyBinding, type HotkeyAction } from "./hotkeys";

const LABELS: Record<HotkeyAction, string> = {
  palette: "Open command palette",
  help: "Show this help",
  tabChain: "Chain tab",
  tabPositions: "Positions tab",
  tabStrategies: "Strategies tab",
  tabSurface: "Surface tab",
  prevExpiry: "Previous expiry",
  nextExpiry: "Next expiry",
  search: "Focus search / palette",
  buyFocused: "Buy focused strike (opens ticket)",
  sellFocused: "Write focused strike (opens ticket)",
  jumpAtm: "Jump to ATM",
  goPortfolio: "Go to Portfolio",
  goHistory: "Go to History",
  goOptions: "Go to Options",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HotkeyHelpOverlay({ open, onClose }: Props) {
  const bindings = typeof window !== "undefined" ? loadBindings() : DEFAULT_BINDINGS;

  if (!open) return null;

  // Dedupe by action for display (palette has meta+ctrl variants)
  const byAction = new Map<HotkeyAction, HotkeyBinding[]>();
  for (const b of bindings) {
    if (!byAction.has(b.action)) byAction.set(b.action, []);
    byAction.get(b.action)!.push(b);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 210, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 440, maxWidth: "92vw", maxHeight: "80vh", overflowY: "auto",
          background: "var(--bg-elevated)", border: "1px solid var(--border-default)", padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-hi)" }}>Keyboard shortcuts</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-lo)", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-mid)", marginBottom: 12 }}>
          Hotkeys are disabled inside text inputs. Buy/Sell only open the order ticket — trades always require the confirm dialog.
        </p>
        {Array.from(byAction.entries()).map(([action, bs]) => (
          <div key={action} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: 12 }}>
            <span style={{ color: "var(--text-mid)" }}>{LABELS[action]}</span>
            <span className="num" style={{ color: "var(--text-hi)" }}>{bs.map(formatBinding).join(" / ")}</span>
          </div>
        ))}
        <p style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 12 }}>
          Customize bindings in localStorage key <code>zenith.hotkeys.v1</code>, or reset via the command palette.
        </p>
      </div>
    </div>
  );
}
