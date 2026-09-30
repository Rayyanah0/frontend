# Error handling guide

- Classify with `classifyError(err)` (`src/lib/errors.ts`): kinds are `network`, `auth`, `validation`, `insufficient_funds`, `rate_limited`, `server`, `wallet_rejected`, `contract`, `unknown`. Each has a user-facing message and recommended action.
- Surface with `toast.fromError(err, { retry, context })` (`src/lib/toast.ts`). The queue is framework-agnostic, so stores and API code can call it. Identical toasts within 5s are merged (`×N`); errors persist until dismissed, success/info auto-dismiss.
- Never write an empty `catch`. Either surface the error or leave a comment explaining the deliberate fallback.
- Wrap independent page regions (chain, positions, charts) in `<RegionErrorBoundary region="...">`.
