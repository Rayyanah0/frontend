export type BatchItemStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export interface BatchItem {
  id: string;
  label: string;
  status: BatchItemStatus;
  error?: string;
}

export interface BatchResult {
  items: BatchItem[];
  stoppedEarly: boolean;
  okCount: number;
  failCount: number;
}

export type CloseMode = "stop" | "continue";

/**
 * Runs async close actions sequentially with per-item status updates.
 * `mode: "stop"` halts after the first failure (remaining → skipped).
 */
export async function runBatchClose(
  items: Array<{ id: string; label: string; run: () => Promise<void> }>,
  opts: {
    mode: CloseMode;
    onUpdate?: (items: BatchItem[]) => void;
  }
): Promise<BatchResult> {
  const state: BatchItem[] = items.map(i => ({ id: i.id, label: i.label, status: "pending" }));
  const emit = () => opts.onUpdate?.(state.map(s => ({ ...s })));

  let stoppedEarly = false;
  for (let i = 0; i < items.length; i++) {
    if (stoppedEarly) {
      state[i].status = "skipped";
      continue;
    }
    state[i].status = "running";
    emit();
    try {
      await items[i].run();
      state[i].status = "ok";
    } catch (err) {
      state[i].status = "failed";
      state[i].error = err instanceof Error ? err.message : String(err);
      if (opts.mode === "stop") stoppedEarly = true;
    }
    emit();
  }
  if (stoppedEarly) {
    for (let i = 0; i < state.length; i++) {
      if (state[i].status === "pending") state[i].status = "skipped";
    }
    emit();
  }

  return {
    items: state,
    stoppedEarly,
    okCount: state.filter(s => s.status === "ok").length,
    failCount: state.filter(s => s.status === "failed").length,
  };
}
