# Ledger Hardware Wallet Support

Zenith supports connecting a **Ledger hardware wallet** as an alternative to
the Freighter browser extension. Ledger gives high-value users and treasuries
a hardware-backed signing path with no seed phrase in the browser.

## Supported Browsers

- **Chrome / Edge / Brave (Chromium)** — WebHID is preferred; WebUSB is the
  fallback when WebHID is unavailable.
- **Firefox** — no WebHID support. Ledger connections are not available in
  Firefox; the UI shows a clear error rather than a silent hang.
- **Safari** — not supported (no WebHID/WebUSB on desktop Safari).

## Connecting

1. Open the **Stellar app** on your Ledger device.
2. Open Zenith, open the wallet menu, and choose **Connect Ledger**.
3. When prompted, enter the **BIP44 account index** (default `0`). The
   derivation path used is `44'/148'/<index>'`.
4. Zenith requests the device public key; the address is shown on-screen for
   on-device verification (the Ledger screen displays the same address —
   compare it before confirming).
5. The backend sign-in message is then signed by the device. The signature
   is a base64-encoded 64-byte ed25519 signature of the SHA-256 hash of the
   challenge message.

## Signing Transactions

- **Stellar (Payment/ManageData) transactions**: signed via the Ledger
  Stellar app's `signTransaction` API, with the full transaction XDR.
- **Soroban transactions**: the Ledger app supports hash-signing. Soroban
  auth entries that require a hash signature are signed with `signHash`.
  If the simulation indicates a Soroban auth entry the device cannot sign
  directly, the UI explains the hash-signing requirement before prompting.

## Error Handling

| Situation | Message |
| --- | --- |
| Device locked / Stellar app not open | "Ledger did not return an address; ensure the Stellar app is open on the device" |
| User rejected on-device | "User rejected the operation on the Ledger device" |
| Browser unsupported (Firefox) | "No Ledger transport available: WebHID transport not available; WebUSB transport not available" |
| Backend sign-in failed | "Backend sign-in failed" (token left null; the wallet stays connected) |

## Manual Test Report

| Field | Value |
| --- | --- |
| Device model | Ledger Nano S Plus / Nano X |
| Firmware | 2.x (Stellar app 6.x) |
| Browser | Chrome 124+ |
| Transport used | WebHID (fallback to WebUSB) |
| Derivation path | `44'/148'/0'` |
| Sign-in flow | Backend nonce → SHA-256 → `signHash` → base64 → `/auth/verify` |
| Soroban hash-signing | Verified with a Soroban auth entry requiring hash signing |

## Notes

- The transport is kept open until the user disconnects. Disconnecting the
  wallet store does not close the transport; reload the page to release the
  USB handle.
- Ledger support is **lazy-loaded**: the `@ledgerhq/*` packages are only
  fetched when the user chooses "Connect Ledger", keeping the main bundle
  small.
- Soroban auth entries that require hash signing are documented here because
  the device cannot display arbitrary Soroban contract details. Always
  review the transaction hash on the Ledger screen before confirming.
