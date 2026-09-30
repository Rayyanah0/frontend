"use client";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useOnline } from "../lib/hooks/useOnline";
import type { ReviewedTransaction } from "../lib/soroban/tx";
import { TransactionSummary } from "./TransactionSummary";

interface ConfirmDialogProps {
  open?: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Clear-signing (#119): the decoded, verified assembled transaction. When
   * present it is shown before the wallet prompt, and a failed intent check
   * disables the confirm button.
   */
  review?: ReviewedTransaction | null;
  children?: React.ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open = true, title, body, confirmLabel, cancelLabel, danger = false,
  onConfirm, onCancel, disabled: disabledProp, disabledReason: reasonProp, review, children,
}: ConfirmDialogProps) {
  const t = useTranslations();
  const online = useOnline();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);

  const mismatch = !!review && !review.verification.ok;
  const disabled = disabledProp || !online || mismatch;
  const disabledReason = !online
    ? t("common.offline")
    : mismatch
      ? t("confirm.blocked")
      : reasonProp;

  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    // Focus the cancel button first (safer default for destructive actions)
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusable?.[0]?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      if (e.key === "Enter" && !disabled) { e.preventDefault(); onConfirm(); return; }
      if (e.key !== "Tab") return;
      const all = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!all.length) return;
      const first = all[0]; const last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [open, onCancel, onConfirm, disabled]);

  useEffect(() => {
    if (!open && returnFocusRef.current instanceof HTMLElement) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const focusStyle = { outline: "2px solid var(--brand)", outlineOffset: "2px" };
  const noOutline = { outline: "none" };

  return (
    <div
      role="presentation"
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={body ? "confirm-dialog-body" : undefined}
        style={{
          width: 420, maxWidth: "90vw",
          background: "var(--bg-raised)",
          border: `1px solid ${danger ? "var(--put)" : "var(--border-default)"}`,
          padding: 24,
        }}
      >
        <h2
          id="confirm-dialog-title"
          style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: danger ? "var(--put)" : "var(--text-hi)" }}
        >
          {title}
        </h2>
        {body && (
          <p id="confirm-dialog-body" style={{ margin: "0 0 20px", fontSize: 13, color: "var(--text-mid)", lineHeight: 1.5 }}>
            {body}
          </p>
        )}
        {children}
        {review && (
          <div style={{ marginTop: children ? 12 : 0 }}>
            <TransactionSummary review={review} />
          </div>
        )}
        {disabled && disabledReason && (
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--put)" }}>{disabledReason}</div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 18px", background: "none", border: "1px solid var(--border-default)",
              color: "var(--text-mid)", fontSize: 12, fontWeight: 600, cursor: "pointer", outline: "none",
            }}
            onFocus={e => Object.assign(e.currentTarget.style, focusStyle)}
            onBlur={e => Object.assign(e.currentTarget.style, noOutline)}
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            style={{
              padding: "6px 18px",
              background: danger ? "var(--put)" : "var(--brand)",
              color: "var(--bg)", border: "none",
              fontSize: 12, fontWeight: 700,
              cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, outline: "none",
            }}
            onFocus={e => Object.assign(e.currentTarget.style, focusStyle)}
            onBlur={e => Object.assign(e.currentTarget.style, noOutline)}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
