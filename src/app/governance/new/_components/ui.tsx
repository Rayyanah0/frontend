"use client";

/**
 * Shared presentational primitives for the proposal wizard.
 *
 * Styling follows the app's Bloomberg-style conventions: inline `style`
 * objects driven by the `globals.css` custom properties, uppercase 10px
 * eyebrows for labels, and mono (`className="num"`) for anything numeric.
 */

import type { CSSProperties, ReactNode } from "react";

export const EYEBROW: CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-lo)",
};

export const PANEL: CSSProperties = {
  border: "1px solid var(--border-default)",
  background: "var(--bg-raised)",
  padding: 20,
};

export const INPUT: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg-overlay)",
  border: "1px solid var(--border-default)",
  color: "var(--text-hi)",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "inherit",
};

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ ...EYEBROW, marginBottom: 6 }}>{children}</div>;
}

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...PANEL, ...style }}>{children}</div>;
}

/** Inline banner used for errors, warnings and notices. */
export function Banner({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger";
  title?: string;
  children?: ReactNode;
}) {
  const palette =
    tone === "danger"
      ? { fg: "var(--put)", bg: "var(--put-dim)" }
      : tone === "warn"
        ? { fg: "var(--atm)", bg: "var(--atm-dim)" }
        : { fg: "var(--brand)", bg: "var(--brand-dim)" };

  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      style={{
        padding: "10px 14px",
        border: `1px solid ${palette.fg}`,
        background: palette.bg,
        color: palette.fg,
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {title && <strong style={{ display: "block", marginBottom: 4 }}>{title}</strong>}
      {children}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
} & Record<string, unknown>) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 20px",
        background: disabled ? "var(--bg-overlay)" : "var(--brand)",
        color: disabled ? "var(--text-lo)" : "var(--bg)",
        fontSize: 13,
        fontWeight: 700,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
} & Record<string, unknown>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        background: "transparent",
        border: "1px solid var(--border-default)",
        color: "var(--text-mid)",
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  onClick,
  disabled,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
} & Record<string, unknown>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 20px",
        background: "var(--put-dim)",
        border: "1px solid var(--put)",
        color: "var(--put)",
        fontSize: 13,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Labelled form row with optional help text and an inline error. */
export function Field({
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={htmlFor} style={{ ...EYEBROW, display: "block", marginBottom: 5 }}>
        {label}
      </label>
      {children}
      {help && !error && (
        <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 4, lineHeight: 1.5 }}>
          {help}
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 11, color: "var(--put)", marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
