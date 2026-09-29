"use client";

interface Props {
  value: number | null;
  max: number;
  label?: string;
  /** Accessible name for the bar. */
  name: string;
}

/**
 * Inline mini-bar for volume / open interest.
 * Shows a clearly marked "N/A" when the backend does not supply the field
 * (never mock values).
 */
export function MiniBar({ value, max, label, name }: Props) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <div className="cc" title={`${name}: not provided by API`} style={{ color: "var(--text-lo)" }}>
        <span aria-label={`${name} not available`}>N/A</span>
      </div>
    );
  }
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const text = label ?? (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)));
  return (
    <div
      className="cc"
      title={`${name}: ${value.toLocaleString()}`}
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, paddingTop: 2, paddingBottom: 2 }}
    >
      <span style={{ fontSize: 10, lineHeight: 1 }}>{text}</span>
      <span
        role="img"
        aria-label={`${name} ${value.toLocaleString()}, ${pct.toFixed(0)}% of max`}
        style={{
          display: "block",
          width: "100%",
          maxWidth: 44,
          height: 3,
          background: "var(--bg-overlay)",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${pct}%`,
            height: "100%",
            background: "var(--heat-bar, var(--brand))",
          }}
        />
      </span>
    </div>
  );
}
