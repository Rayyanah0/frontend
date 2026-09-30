"use client";

// Bridges the pipeline's `onReview` callback to a ConfirmDialog (#119).
//
//   const clearSign = useClearSign();
//   await executeContractCall({ ...params, intent, onReview: clearSign.onReview }, onEvent);
//   …
//   {clearSign.dialog}

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import type { ReviewedTransaction } from "./tx";

export function useClearSign(title?: string, confirmLabel?: string) {
  const t = useTranslations("clearSign");
  const [review, setReview] = useState<ReviewedTransaction | null>(null);
  const resolver = useRef<((approved: boolean) => void) | null>(null);

  const settle = useCallback((approved: boolean) => {
    resolver.current?.(approved);
    resolver.current = null;
    setReview(null);
  }, []);

  const onReview = useCallback((next: ReviewedTransaction) => {
    resolver.current?.(false); // a newer review supersedes any pending one
    setReview(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog = review ? (
    <ConfirmDialog
      title={title ?? t("reviewTitle")}
      confirmLabel={confirmLabel ?? t("continueToWallet")}
      review={review}
      onConfirm={() => settle(review.verification.ok)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { onReview, dialog, pending: review };
}
