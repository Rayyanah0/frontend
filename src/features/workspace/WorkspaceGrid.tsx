"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GridLayout, verticalCompactor, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  BUILTIN_PRESETS,
  exportLayout,
  importLayout,
  loadNamedLayout,
  loadWorkspace,
  listSavedLayouts,
  PANEL_META,
  saveNamedLayout,
  saveWorkspace,
  type PanelId,
  type WorkspaceLayout,
} from "./layouts";

interface Props {
  wallet: string | null;
  renderPanel: (id: PanelId) => React.ReactNode;
  width?: number;
}

export function WorkspaceGrid({ wallet, renderPanel, width = 1200 }: Props) {
  const [layout, setLayout] = useState<WorkspaceLayout>(() =>
    typeof window === "undefined" ? BUILTIN_PRESETS[0] : loadWorkspace(wallet)
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLayout(loadWorkspace(wallet));
    setHydrated(true);
  }, [wallet]);

  useEffect(() => {
    if (!hydrated) return;
    saveWorkspace(wallet, layout);
  }, [layout, wallet, hydrated]);

  const onLayoutChange = useCallback((next: Layout) => {
    setLayout(prev => ({
      ...prev,
      panels: next.map(n => {
        const prevItem = prev.panels.find(p => p.i === n.i);
        return {
          i: n.i as PanelId,
          x: n.x, y: n.y, w: n.w, h: n.h,
          minW: prevItem?.minW ?? n.minW, minH: prevItem?.minH ?? n.minH,
        };
      }),
    }));
  }, []);

  const visible = useMemo(() => layout.panels.filter(p => !layout.hidden.includes(p.i)), [layout]);
  const hiddenIds = useMemo(() => {
    const all = Object.keys(PANEL_META) as PanelId[];
    const present = new Set(layout.panels.map(p => p.i));
    return all.filter(id => layout.hidden.includes(id) || !present.has(id));
  }, [layout]);

  const closePanel = (id: PanelId) => {
    setLayout(prev => ({
      ...prev,
      panels: prev.panels.filter(p => p.i !== id),
      hidden: prev.hidden.includes(id) ? prev.hidden : [...prev.hidden, id],
    }));
  };

  const addPanel = (id: PanelId) => {
    setLayout(prev => {
      const maxY = prev.panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);
      return {
        ...prev,
        hidden: prev.hidden.filter(h => h !== id),
        panels: [
          ...prev.panels.filter(p => p.i !== id),
          { i: id, x: 0, y: maxY, w: 4, h: 4, minW: 2, minH: 2 },
        ],
      };
    });
    setMenuOpen(false);
  };

  const applyPreset = (preset: WorkspaceLayout) => {
    setLayout({ ...preset, panels: preset.panels.map(p => ({ ...p })) });
    setMenuOpen(false);
  };

  const savedNames = typeof window !== "undefined" ? listSavedLayouts(wallet) : [];
  const gridWidth = Math.max(640, width - 16);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
        borderBottom: "1px solid var(--border-default)", background: "var(--bg-raised)", flexShrink: 0,
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 11, color: "var(--text-lo)" }}>Layout</span>
        <strong style={{ fontSize: 12, color: "var(--text-hi)" }}>{layout.name}</strong>
        {BUILTIN_PRESETS.map(p => (
          <button key={p.name} onClick={() => applyPreset(p)} style={btn(layout.name === p.name)}>
            {p.name}
          </button>
        ))}
        <button onClick={() => setMenuOpen(v => !v)} style={btn(menuOpen)}>+ Panel</button>
        <button onClick={() => applyPreset(BUILTIN_PRESETS[0])} style={btn(false)}>Reset</button>
        <button
          onClick={() => {
            const blob = new Blob([exportLayout(layout)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `zenith-layout-${layout.name}.json`; a.click();
            URL.revokeObjectURL(url);
          }}
          style={btn(false)}
        >Export</button>
        <label style={{ ...btn(false), cursor: "pointer" }}>
          Import
          <input
            type="file" accept="application/json" hidden
            onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              const imported = importLayout(text);
              if (imported) setLayout(imported);
              e.target.value = "";
            }}
          />
        </label>
        <input
          value={saveName}
          onChange={e => setSaveName(e.target.value)}
          placeholder="Save as…"
          style={{
            fontSize: 11, padding: "3px 8px", width: 100, background: "var(--bg-overlay)",
            border: "1px solid var(--border-default)", color: "var(--text-hi)",
          }}
        />
        <button
          onClick={() => {
            if (!saveName.trim()) return;
            const named = { ...layout, name: saveName.trim() };
            saveNamedLayout(wallet, named);
            setLayout(named);
            setSaveName("");
          }}
          style={btn(false)}
        >Save</button>
        {savedNames.map(n => (
          <button
            key={n}
            onClick={() => {
              const loaded = loadNamedLayout(wallet, n);
              if (loaded) setLayout(loaded);
            }}
            style={btn(layout.name === n)}
          >{n}</button>
        ))}
      </div>

      {menuOpen && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 10px",
          borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-elevated)",
        }}>
          {hiddenIds.length === 0 && (
            <span style={{ fontSize: 11, color: "var(--text-lo)" }}>All panels visible</span>
          )}
          {hiddenIds.map(id => (
            <button key={id} onClick={() => addPanel(id)} style={btn(false)}>
              + {PANEL_META[id].title}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: 8, background: "var(--bg)" }}>
        {!hydrated ? (
          <div style={{ fontSize: 12, color: "var(--text-lo)", padding: 24 }}>Loading workspace…</div>
        ) : (
          <GridLayout
            className="zenith-workspace"
            width={gridWidth}
            layout={visible.map(p => ({ i: p.i, x: p.x, y: p.y, w: p.w, h: p.h, minW: p.minW, minH: p.minH }))}
            gridConfig={{ cols: 12, rowHeight: 36, margin: [8, 8] }}
            dragConfig={{ handle: ".ws-drag", enabled: true }}
            resizeConfig={{ enabled: true }}
            compactor={verticalCompactor}
            onLayoutChange={onLayoutChange}
          >
            {visible.map(p => (
              <div key={p.i} style={{
                background: "var(--bg-raised)", border: "1px solid var(--border-default)",
                display: "flex", flexDirection: "column", overflow: "hidden",
              }}>
                <div className="ws-drag" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "4px 8px", borderBottom: "1px solid var(--border-subtle)",
                  cursor: "grab", background: "var(--bg-overlay)", flexShrink: 0,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-hi)" }}>
                    {PANEL_META[p.i].title}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); closePanel(p.i); }}
                    style={{ background: "none", border: "none", color: "var(--text-lo)", cursor: "pointer", fontSize: 14 }}
                    aria-label={`Close ${PANEL_META[p.i].title}`}
                  >×</button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  {renderPanel(p.i)}
                </div>
              </div>
            ))}
          </GridLayout>
        )}
      </div>
    </div>
  );
}

const btn = (on: boolean): React.CSSProperties => ({
  fontSize: 11, padding: "3px 8px", cursor: "pointer",
  background: on ? "var(--atm-dim)" : "transparent",
  border: "1px solid var(--border-default)",
  color: on ? "var(--atm)" : "var(--text-lo)",
});
