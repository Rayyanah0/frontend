"use client";
import { useEffect, useRef, ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Width in pixels, defaults to 480 */
  width?: number;
}

/**
 * Accessible dialog with focus trap and return-focus.
 * Meets WCAG 2.2 criteria: 2.1.1 (keyboard), 2.1.2 (no trap), 2.4.11 (focus visible).
 */
export function Dialog({ open, onClose, title, description, children, width = 480 }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Save trigger and trap focus when opened
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;

    // Focus first focusable element
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const el = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Return focus when closed
  useEffect(() => {
    if (!open && triggerRef.current instanceof HTMLElement) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? "dialog-desc" : undefined}
        style={{
          width, maxWidth: "90vw",
          background: "var(--bg-raised)",
          border: "1px solid var(--border-default)",
          padding: 24, position: "relative",
          maxHeight: "85vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 id="dialog-title" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>
              {title}
            </h2>
            {description && (
              <p id="dialog-desc" style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-mid)" }}>
                {description}
              </p>
            )}
          </div>
          <button
            aria-label="Close dialog"
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "var(--text-lo)",
              fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4,
              outline: "none",
            }}
            onFocus={e => { e.currentTarget.style.outline = "2px solid var(--brand)"; e.currentTarget.style.outlineOffset = "2px"; }}
            onBlur={e => { e.currentTarget.style.outline = "none"; }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
