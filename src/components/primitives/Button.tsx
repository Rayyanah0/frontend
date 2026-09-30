"use client";
import { ButtonHTMLAttributes, forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "var(--brand)", color: "var(--bg)", border: "none" },
  secondary: { background: "var(--bg-elevated)", color: "var(--text-hi)", border: "1px solid var(--border-default)" },
  ghost: { background: "none", color: "var(--text-mid)", border: "1px solid var(--border-default)" },
  danger: { background: "var(--put-dim)", color: "var(--put)", border: "1px solid var(--put)" },
};

const SIZE_STYLES: Record<ButtonSize, React.CSSProperties> = {
  sm: { fontSize: 11, padding: "3px 10px", minHeight: 28 },
  md: { fontSize: 12, padding: "6px 16px", minHeight: 32 },
  lg: { fontSize: 13, padding: "8px 20px", minHeight: 40 },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, disabled, children, style, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading ?? undefined}
      {...props}
      style={{
        cursor: disabled || loading ? "default" : "pointer",
        fontWeight: 600,
        fontFamily: "inherit",
        outline: "none",
        transition: "opacity 0.1s",
        opacity: disabled ? 0.45 : 1,
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        ...style,
      }}
      onFocus={e => {
        (e.currentTarget as HTMLButtonElement).style.outline = "2px solid var(--brand)";
        (e.currentTarget as HTMLButtonElement).style.outlineOffset = "2px";
        props.onFocus?.(e);
      }}
      onBlur={e => {
        (e.currentTarget as HTMLButtonElement).style.outline = "none";
        props.onBlur?.(e);
      }}
    >
      {loading ? "…" : children}
    </button>
  );
});
