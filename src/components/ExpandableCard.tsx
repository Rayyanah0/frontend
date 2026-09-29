"use client";

import { useState } from "react";

interface Props {
  /** Primary line — always visible on the collapsed card. */
  title: React.ReactNode;
  /** Secondary line directly under the title (kept short). */
  subtitle?: React.ReactNode;
  /** Right-aligned value in the header, e.g. P&L. */
  trailing?: React.ReactNode;
  /** Everything that only shows once the card is expanded. */
  details?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Mobile replacement for a desktop table row: the essential figures stay in
 * the always-visible header (a >=56px tall button, so it's a comfortable
 * touch target) and the secondary columns live in the expandable body.
 *
 * Cards render one per data row; the whole header is the toggle, and the
 * chevron gives the affordance a 44x44px hit area of its own.
 */
export function ExpandableCard({
  title,
  subtitle,
  trailing,
  details,
  defaultOpen = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`zn-card ${className}`.trim()}>
      <button
        type="button"
        className="zn-card-head"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>{title}</span>
          {subtitle ? <span style={{ fontSize: 11, color: "var(--text-mid)" }}>{subtitle}</span> : null}
        </span>
        {trailing ? <span style={{ marginLeft: "auto", textAlign: "right" }}>{trailing}</span> : null}
        <span className="zn-card-chevron" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && details ? <div className="zn-card-body">{details}</div> : null}
    </div>
  );
}
