"use client";
import { ButtonHTMLAttributes, forwardRef } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label — required, used as aria-label if no visible text */
  label: string;
  size?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 28, disabled, children, style, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      disabled={disabled}
      {...props}
      style={{
        width: size,
        height: size,
        minWidth: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        color: "var(--text-lo)",
        padding: 0,
        opacity: disabled ? 0.4 : 1,
        outline: "none",
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
      {children}
    </button>
  );
});
