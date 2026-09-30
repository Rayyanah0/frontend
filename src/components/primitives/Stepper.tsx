"use client";
import { useId } from "react";

interface StepperProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** Unit suffix e.g. "contracts" */
  unit?: string;
}

/**
 * Accessible numeric stepper. Exposes the value via aria-valuenow/min/max/
 * text, and labels each button descriptively. Meets WCAG 2.2 criteria:
 * 1.3.1 (info & relationships), 4.1.2 (name/role/value).
 */
export function Stepper({
  label, value, min = 0, max = Infinity, step = 1, onChange, disabled, unit,
}: StepperProps) {
  const id = useId();
  const canDec = !disabled && value - step >= min;
  const canInc = !disabled && value + step <= max;
  const displayMax = isFinite(max) ? max : undefined;

  return (
    <div role="group" aria-labelledby={id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span id={id} style={{ fontSize: 10, color: "var(--text-lo)", marginRight: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <button
        aria-label={`Decrease ${label}`}
        disabled={!canDec}
        onClick={() => onChange(Math.max(min, value - step))}
        style={{
          width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg-elevated)", border: "1px solid var(--border-default)",
          color: canDec ? "var(--text-hi)" : "var(--text-lo)",
          cursor: canDec ? "pointer" : "default", fontSize: 14, outline: "none",
        }}
        onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
        onBlur={e => { e.currentTarget.style.outline = "none"; }}
      >
        −
      </button>
      <span
        role="spinbutton"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={isFinite(min) ? min : undefined}
        aria-valuemax={displayMax}
        aria-valuetext={unit ? `${value} ${unit}` : String(value)}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={e => {
          if (e.key === "ArrowUp" && canInc) onChange(Math.min(max, value + step));
          if (e.key === "ArrowDown" && canDec) onChange(Math.max(min, value - step));
        }}
        style={{
          minWidth: 40, textAlign: "center",
          fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)",
          color: disabled ? "var(--text-lo)" : "var(--text-hi)",
          outline: "none",
          padding: "0 4px",
        }}
        onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
        onBlur={e => { e.currentTarget.style.outline = "none"; }}
      >
        {value}{unit ? <><span style={{ fontSize: 9, marginLeft: 2, color: "var(--text-lo)" }}>{unit}</span></> : null}
      </span>
      <button
        aria-label={`Increase ${label}`}
        disabled={!canInc}
        onClick={() => onChange(Math.min(max, value + step))}
        style={{
          width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg-elevated)", border: "1px solid var(--border-default)",
          color: canInc ? "var(--text-hi)" : "var(--text-lo)",
          cursor: canInc ? "pointer" : "default", fontSize: 14, outline: "none",
        }}
        onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
        onBlur={e => { e.currentTarget.style.outline = "none"; }}
      >
        +
      </button>
    </div>
  );
}
