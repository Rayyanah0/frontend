// Lightweight Ledger signer adapter — lazy-loads transport and app.
// Uses WebHID where available, falls back to WebUSB. Exposes a minimal
// interface for connecting, getting an address, and signing blobs/hashes.
// All ledger dependencies are imported dynamically so the adapter is
// only loaded when the user explicitly chooses "Connect Ledger".

type LedgerConnectResult = {
  address: string;
  publicKey: string;
  signMessage: (message: string) => Promise<string>;
  signHash: (hashHex: string) => Promise<string>;
  close: () => Promise<void>;
};

export async function connectLedgerAccount(accountIndex = 0, preferWebHID = true): Promise<LedgerConnectResult> {
  // Dynamic import so consumers only pull ledger libs when requested.
  let Transport: any = null;
  let Str: any = null;

  // Try WebHID first (modern Chromium browsers); fallback to WebUSB.
  const errors: string[] = [];
  if (preferWebHID) {
    try {
      const mod = await import("@ledgerhq/hw-transport-webhid");
      Transport = mod.default || mod.TransportWebHID || mod;
    } catch (err: any) {
      errors.push("WebHID transport not available");
    }
  }

  if (!Transport) {
    try {
      const mod = await import("@ledgerhq/hw-transport-webusb");
      Transport = mod.default || mod.TransportWebUSB || mod;
    } catch (err: any) {
      errors.push("WebUSB transport not available");
    }
  }

  if (!Transport) {
    throw new Error("No Ledger transport available: " + errors.join("; "));
  }

  try {
    const mod = await import("@ledgerhq/hw-app-str");
    Str = mod.default || mod;
  } catch (err: any) {
    throw new Error("Ledger Stellar app library could not be loaded: " + String(err));
  }

  // Create transport and app instance. `request()` prompts the user to
  // connect a device; on Firefox (no WebHID) this throws a clear error.
  const transport = await Transport.request();
  const app = new Str(transport);

  // Standard SLIP-0010/BIP44 Stellar path: 44'/148'/accountIndex'
  const path = `44'/148'/${accountIndex}'`;

  // getAddress is the common method exposed by hw-app-str.
  // Response shape may vary between versions; defensively handle it.
  const addrResp = await app.getAddress(path, { verify: true }).catch(async (e: any) => {
    // Some versions expect different arg signature — try without options.
    return app.getAddress(path).catch((err2: any) => { throw err2; });
  });

  const address = addrResp?.address || addrResp?.publicKey || addrResp?.public_key;
  const publicKey = addrResp?.publicKey || addrResp?.public_key || null;

  if (!address) {
    await transport.close().catch(() => {});
    throw new Error("Ledger did not return an address; ensure the Stellar app is open on the device");
  }

  // signMessage: ledger may not have a generic "sign message" helper for
  // arbitrary blobs, so we hash the message (sha256) and ask the ledger to
  // sign the hash. The caller (backend verify) expects a base64 signature.
  async function signMessage(message: string) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(message);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hashHex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    return signHash(hashHex);
  }

  async function signHash(hashHex: string) {
    // hw-app-str typically exposes `signHash` or `signTransaction` APIs.
    // Try common names.
    const hex = hashHex.startsWith("0x") ? hashHex.slice(2) : hashHex;
    if (typeof app.signHash === "function") {
      const sig = await app.signHash(path, hex);
      // sig may come back as { signature: '...' } or as raw hex string
      if (sig?.signature) return sig.signature;
      if (typeof sig === "string") return sig;
      if (sig?.sigHex) return sig.sigHex;
    }

    // Fallback to signTransaction if provided; caller must produce tx XDR.
    if (typeof app.signTransaction === "function") {
      const sig = await app.signTransaction(path, hex);
      return sig?.signature || sig;
    }

    throw new Error("Ledger app doesn't support signing this payload (no signHash/signTransaction available)");
  }

  return {
    address,
    publicKey: publicKey ?? "",
    signMessage,
    signHash,
    close: async () => {
      try {
        await transport.close();
      } catch {}
    },
  };
}

export default connectLedgerAccount;