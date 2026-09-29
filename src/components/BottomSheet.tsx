"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the sheet (it's a modal dialog). */
  ariaLabel: string;
  /**
   * True while another modal (the trade confirm dialog) is layered above the
   * sheet: Escape and the Tab focus trap are then handed to that dialog, so
   * one Escape press closes exactly one layer and keyboard users can reach
   * the confirm buttons.
   */
  suspended?: boolean;
  /** Fraction of the visual viewport the sheet may occupy. */
  maxHeightRatio?: number;
  /** Pixels of downward drag that dismiss the sheet. */
  dismissThreshold?: number;
  children: React.ReactNode;
}

interface ViewportMetrics {
  /** Height of the *visible* viewport (shrinks when the keyboard opens). */
  height: number;
  /** How far below the visible viewport the layout-viewport bottom sits. */
  hiddenBelow: number;
}

const initialMetrics: ViewportMetrics = { height: 0, hiddenBelow: 0 };

/**
 * Mobile bottom sheet — the mobile presentation of the order ticket.
 *
 * Handles the awkward parts of mobile viewports so callers don't have to:
 *  - `visualViewport` tracking so the on-screen keyboard never covers the
 *    sheet (the sheet is lifted by exactly what the keyboard hides and is
 *    capped to the visible height);
 *  - iOS safe-area padding (see .zn-sheet in globals.css);
 *  - drag-to-dismiss on the grab handle;
 *  - body scroll lock, Escape-to-close, backdrop tap, focus restore.
 *
 * It is intentionally dependency-free and renders in place (no portal), so it
 * works with the existing Providers/component tree.
 */
export function BottomSheet({
  open,
  onClose,
  ariaLabel,
  suspended = false,
  maxHeightRatio = 0.9,
  dismissThreshold = 120,
  children,
}: Props) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<ViewportMetrics>(initialMetrics);
  const [dragY, setDragY] = useState(0);
  const [entered, setEntered] = useState(false);
  const drag = useRef<{ id: number; startY: number } | null>(null);
  // Mirror of dragY for the pointer-up handler (state read inside a callback
  // would be stale by one render).
  const dragYRef = useRef(0);
  // Latest-value refs for the open/close effects below. The caller rebuilds
  // these closures on every render (price ticks, keystrokes in the ticket),
  // and letting that re-run the focus effect would yank focus out of the
  // contracts input mid-typing — which closes the on-screen keyboard.
  const onCloseRef = useRef(onClose);
  const suspendedRef = useRef(suspended);
  useEffect(() => {
    onCloseRef.current = onClose;
    suspendedRef.current = suspended;
  }, [onClose, suspended]);

  /* ---------- viewport (dvh / keyboard awareness) ---------- */
  useEffect(() => {
    if (!open) return;
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const measure = () => {
      const layoutHeight = window.innerHeight;
      const height = vv ? vv.height : window.innerHeight;
      const offsetTop = vv ? vv.offsetTop : 0;
      setMetrics({ height, hiddenBelow: Math.max(0, layoutHeight - (height + offsetTop)) });
    };
    measure();
    window.addEventListener("resize", measure);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [open]);

  /* ---------- enter animation + background scroll lock ---------- */
  useEffect(() => {
    if (!open) {
      setEntered(false);
      setDragY(0);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, [open]);

  /* ---------- escape to close + focus handling ---------- */
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus into the dialog so keyboard/screen-reader users land inside.
    sheetRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      // While a confirm dialog sits above the sheet, that dialog owns the
      // keyboard — otherwise one Escape press would close both layers.
      if (suspendedRef.current) return;
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      // Focus trap: keep Tab / Shift+Tab cycling inside the modal dialog
      // (aria-modal promises exactly this to screen-reader users).
      if (e.key !== "Tab") return;
      const root = sheetRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && root.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // When the keyboard opens (visual viewport shrinks) pull the focused
    // field back into view inside the sheet's own scroll area — this is the
    // "keyboard must not hide the fields" requirement.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !sheetRef.current?.contains(target)) return;
      window.setTimeout(() => {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }, 220);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      previouslyFocused?.focus?.();
    };
    // Intentionally open-only: re-running on closure identity changes would
    // steal focus from the ticket's inputs on every parent re-render.
  }, [open]);

  /* ---------- drag to dismiss ---------- */
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { id: e.pointerId, startY: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const next = Math.max(0, e.clientY - drag.current.startY);
    dragYRef.current = next;
    setDragY(next);
  }, []);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    const travelled = dragYRef.current;
    dragYRef.current = 0;
    setDragY(0);
    if (travelled >= dismissThreshold) onClose();
  }, [dismissThreshold, onClose]);

  if (!open) return null;

  const maxHeight = metrics.height
    ? Math.min(metrics.height * maxHeightRatio, metrics.height - 16)
    : undefined;

  return (
    <>
      <div className="zn-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className="zn-sheet"
        style={{
          maxHeight,
          // Before the enter transition starts the sheet sits fully below the
          // fold; afterwards it rests on the visual viewport's bottom edge
          // (lifted by exactly what the on-screen keyboard hides).
          transform: `translateY(${entered ? -metrics.hiddenBelow + dragY : (metrics.height || 600)}px)`,
          transition: drag.current ? "none" : "transform 220ms cubic-bezier(0.22,0.61,0.36,1)",
        }}
      >
        <div
          className="zn-sheet-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-hidden="true"
        >
          <span />
        </div>
        <div className="zn-sheet-body">{children}</div>
      </div>
    </>
  );
}
