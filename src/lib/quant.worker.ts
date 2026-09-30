/**
 * quant.worker.ts — Web Worker entry point for Issue #64.
 *
 * Bundled as a separate worker chunk. The main thread creates it via
 *   new Worker(new URL('./quant.worker.ts', import.meta.url))
 * in src/lib/useQuantWorker.ts.
 */
import { handleWorkerMessage } from "./quantWorker";

self.onmessage = (e: MessageEvent) => {
  const response = handleWorkerMessage(e);
  (self as unknown as Worker).postMessage(response);
};
