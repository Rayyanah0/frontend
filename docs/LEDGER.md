# Ledger Hardware Wallet Support (Stellar)

This document describes the Ledger integration added to the frontend, how to manually test with a device, and PR guidance.

## What was added
- `src/lib/ledgerSigner.ts` — lazy-loading Ledger adapter (WebHID/WebUSB) that connects to the device, retrieves an address by BIP44 path `44'/148'/INDEX'`, and exposes `signMessage`/`signHash` helpers.
- `src/lib/store/wallet.ts` — new `connectLedger(index?: number)` store action that connects via the Ledger adapter and performs the backend sign-in using the Ledger-provided signature.
- `src/components/WalletConnect.tsx` — UI now exposes a `Connect Ledger` button that prompts for an account index.

## Manual hardware test checklist
Run the following scenarios and record results in your PR description (required):

- Device & app detection
  - Connect Ledger device and open the Stellar app.
  - Click `Connect Ledger` and enter index `0`.
  - Expected: the app prompts on-device to allow address retrieval and the UI shows the truncated address.

- Transaction signing (Soroban / Stellar tx)
  - Initiate a sample transaction that requires on-device signing.
  - Expected: the device shows the transaction prompts; the app waits and completes signing.
  - For Soroban transactions that require blind-signing or hash signing, verify the device prompts and note whether the Ledger firmware/app supports hash signing for the given payload.

- Error cases
  - Device locked: Ensure the UI surfaces the error when device is locked.
  - App not open: Ensure UI surfaces a helpful error when the Stellar app isn't open.
  - User rejection: Cancel prompts on-device and verify UI handles rejection gracefully.
  - Unsupported browser: Verify WebHID availability in Chromium-based browsers (Firefox may not support WebHID).

Record the device model, firmware version, browser and OS used, and step-by-step observations.

## Tests
Unit tests were not added in this change set. To add tests, mock dynamic imports of the Ledger transport and `hw-app-str` module and validate that `connectLedgerAccount` and `connectLedger` handle success and error flows. Jest + ts-jest is recommended.

## Dependency notes
This implementation lazy-loads `@ledgerhq/hw-transport-webhid`, `@ledgerhq/hw-transport-webusb`, and `@ledgerhq/hw-app-str`. Install them with:

```bash
npm install --save @ledgerhq/hw-transport-webhid @ledgerhq/hw-transport-webusb @ledgerhq/hw-app-str
```

## PR guidance
- Create a feature branch from `main` and include all commits there.
- The PR description must include the manual test report and four `Closes #issue-number` lines referencing issues: `#80`, `#81`, `#82`, `#83`.
- Ensure CI passes and include notes about browsers tested and device firmware.

*** End of file
