# Clear-signing (#119)

Wallets usually show a Soroban invocation as opaque data. A compromised
dependency, RPC node, or API could change an argument, such as the strike,
the size, or the withdrawal recipient, after the user confirms but before
the wallet signs. Clear-signing adds a separate check in the app itself.
It decodes the transaction that is about to be signed and compares it with
what the user asked for. On any difference, signing is blocked.

```
UI state ──▶ TxIntent ─────────────────────────────┐
                                                    ▼
params ─▶ build ─▶ simulate ─▶ assemble ─▶ XDR ─▶ decode ─▶ verifyIntent ─▶ ok? ─▶ ConfirmDialog ─▶ wallet
                                                                     │                               │
                                                                     └─ mismatch: report + block     └─ signed hash must equal reviewed hash
```

## Modules

| File | Role |
|---|---|
| `src/lib/soroban/contracts/spec.ts` | Function spec for Zenith contracts: argument names, ScVal types, units, and decimals. Mirrors `contracts/index.ts`. |
| `src/lib/soroban/decode.ts` | Decodes the **final assembled** XDR into operations, invocations with typed arguments, auth trees, and fees. Unknown contracts are shown as raw data with a warning. |
| `src/lib/soroban/intent.ts` | Pure comparator: `verifyIntent(decoded, intent, opts)` returns every mismatch it finds. It has 100% coverage, enforced in `jest.config.js`. |
| `src/lib/soroban/tx.ts` | `reviewTransaction` (decode, verify, then report any mismatch to monitoring), `assertVerified`, and `assertSignedMatchesReviewed`. |
| `src/lib/soroban/units.ts` | Exact bigint fixed-point helpers, safe for i128. |
| `src/components/TransactionSummary.tsx` | Readable summary: arguments with units, shortened addresses with a copy button, the auth tree, fees, warnings, and the raw XDR. |
| `src/components/ConfirmDialog.tsx` | New `review` prop. The confirm button is disabled when verification fails. |
| `src/lib/soroban/useClearSign.tsx` | Connects the pipeline's `onReview` callback to a `ConfirmDialog`. |

## Usage

```tsx
const clearSign = useClearSign();

await executeContractCall(
  {
    contract: contracts.market,
    method: "open_position",
    args,
    signer,
    // Built from UI state (human units), NOT from `args`:
    intent: { kind: "open_position", caller: address, underlying: "XLM", strike: "0.125",
              expiryLedger, side: "call", direction: "long", contracts: 10 },
    onReview: clearSign.onReview,
  },
  onEvent
);

return <>{clearSign.dialog}</>;
```

## What is checked

- Exactly one operation, and it is a contract invocation.
- The transaction source (and any operation source) is the intent's caller.
- The contract id matches the configured Zenith contract for the action.
- The function name matches the action.
- The argument count matches. Every argument's ScVal type matches the spec,
  and every value matches the intent after its own conversion to base units.
- At least one auth entry exists. Address credentials belong to the caller
  only. Each auth root is **exactly** the top-level call.
- Auth sub-invocations only call Zenith contracts or contracts listed in
  `allowedSubContracts` (for example the collateral token's SAC).
- Optional: the total fee is at most `maxFeeStroops`.
- After signing, the hash of the XDR the wallet returns equals the reviewed hash.

When a check fails, `captureError` is called with the
`clear-signing / intent-mismatch / <kind>` fingerprint, the pipeline emits
`failed`, and the wallet is never prompted.

## Out of scope

Clear-signing on the wallet side, such as Ledger or SEP-style display.
