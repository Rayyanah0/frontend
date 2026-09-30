"use client";

import type { HeatScale } from "../lib/heatScale";

interface Props {
  value: number;
  display: string;
  scale: HeatScale | null;
  active: boolean;
  title?: string;
  className?: string;
  onClick?: () => void;
}

/** Heat-colored cell that always keeps the numeric text visible. */
export function HeatCell({ value, display, scale, active, title, className = "cc", onClick }: Props) {
  if (!active || !scale) {
    return (
      <div className={className} title={title} onClick={onClick}>
        {display}
      </div>
    );
  }
  return (
    <div
      className={className}
      title={title ?? `${display} (heat)`}
      onClick={onClick}
      style={{
        background: scale.bg(value),
        color: scale.fg(value),
        fontWeight: 600,
      }}
    >
      <span className="sr-only">{title ?? display}</span>
      {display}
    </div>
  );
}
