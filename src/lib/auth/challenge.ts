/**
 * challenge.ts
 * Origin binding and allowed-origins enforcement for anti-phishing.
 * Issue #128: Anti-Phishing Protections
 */

/**
 * The set of origins where Zenith is officially hosted.
 * Preview/staging origins can be added via NEXT_PUBLIC_ALLOWED_ORIGINS
 * (comma-separated). In development, localhost is always allowed.
 */
export function getAllowedOrigins(): string[] {
  const base = [
    "https://app.zenith.trade",
    "https://zenith.trade",
  ];

  // Allow additional preview/staging origins configured at build time
  const extra: string =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ALLOWED_ORIGINS) || "";
  const extras = extra.split(",").map(s => s.trim()).filter(Boolean);

  return [...base, ...extras];
}

/**
 * Check whether the current window.location.origin is an official Zenith origin.
 * Always returns true in development (localhost / 127.0.0.1) so local builds work.
 * Returns true in non-browser environments (SSR).
 */
export function isOfficialOrigin(origin?: string): boolean {
  if (typeof window === "undefined") return true; // SSR
  const current = origin ?? window.location.origin;
  if (
    current.startsWith("http://localhost") ||
    current.startsWith("http://127.0.0.1") ||
    current.startsWith("http://0.0.0.0")
  ) {
    return true;
  }
  return getAllowedOrigins().some(o => current === o || current.startsWith(o));
}

/**
 * In production, assert that the current origin is official.
 * Throws a descriptive error if running on an unlisted origin,
 * which prevents phishing clones from silently operating.
 *
 * Call this once at app startup (e.g., in root layout useEffect).
 */
export function assertOfficialOrigin(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!isOfficialOrigin()) {
    throw new Error(
      `[Zenith Security] This app is running on an unofficial origin: ${typeof window !== "undefined" ? window.location.origin : "unknown"}. ` +
        `Official origins are: ${getAllowedOrigins().join(", ")}. ` +
        `If you reached this page via a link, you may be on a phishing site. ` +
        `Please navigate to https://app.zenith.trade directly.`
    );
  }
}

/**
 * Returns a human-readable statement about the current signing context,
 * suitable for display in the wallet prompt before asking the user to sign.
 * This makes it visually obvious which domain is requesting the signature.
 */
export function getSigningStatement(walletAddress: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.zenith.trade";
  const official = isOfficialOrigin(origin);
  return [
    `You are signing in to Zenith Options Protocol.`,
    ``,
    `Origin: ${origin}${official ? " ✓ (official)" : " ⚠ (UNVERIFIED — check this URL carefully!)"}`,
    `Account: ${walletAddress}`,
    ``,
    official
      ? `This is an official Zenith domain. Your signature only grants session access.`
      : `WARNING: This origin is not on Zenith's official domain list. Do not sign unless you are absolutely certain this is legitimate.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Address poisoning detection
// ---------------------------------------------------------------------------

export interface PoisoningResult {
  /** True if the address looks like a poisoning attack */
  poisoned: boolean;
  /** The known address it mimics, if poisoned */
  matchedAddress?: string;
  /** Human-readable warning message */
  warning?: string;
}

/**
 * Detect address-poisoning attacks.
 *
 * A poisoned address is one that:
 *  - Shares the first `matchLen` characters with a known address, AND
 *  - Shares the last `matchLen` characters with a known address, AND
 *  - Is not identical to the known address.
 *
 * This heuristic catches the common attack where a malicious actor sends dust
 * to a vanity address that looks identical at a glance in truncated displays.
 *
 * Handles Stellar address types:
 *  - G… (ed25519 public key, 56 chars)
 *  - M… (muxed account, 69 chars)
 *  - C… (contract address)
 *
 * @param input      The address the user pasted / typed
 * @param known      Array of trusted addresses (address book, recent recipients)
 * @param matchLen   Characters to compare at each end (default: 4)
 */
export function detectAddressPoisoning(
  input: string,
  known: string[],
  matchLen = 4
): PoisoningResult {
  const inp = input.trim();
  if (inp.length < matchLen * 2) return { poisoned: false };

  for (const addr of known) {
    if (inp === addr) continue; // exact match — safe
    if (
      addr.length >= matchLen * 2 &&
      inp.slice(0, matchLen) === addr.slice(0, matchLen) &&
      inp.slice(-matchLen) === addr.slice(-matchLen)
    ) {
      return {
        poisoned: true,
        matchedAddress: addr,
        warning:
          `This address looks similar to a known address but differs in the middle. ` +
          `This may be an address-poisoning attack. ` +
          `Known: ${addr.slice(0, 8)}…${addr.slice(-8)} — ` +
          `Input: ${inp.slice(0, 8)}…${inp.slice(-8)}`,
      };
    }
  }
  return { poisoned: false };
}

/**
 * Validate that a Stellar address has valid format.
 * Accepts G… (56), M… (69), C… (56) addresses.
 */
export function isValidStellarAddress(address: string): boolean {
  const a = address.trim();
  // G-addresses: 56 chars, base32 alphabet
  if (/^G[A-Z2-7]{55}$/.test(a)) return true;
  // M-addresses (muxed): start with M, 69 chars
  if (/^M[A-Z2-7]{68}$/.test(a)) return true;
  // C-addresses (contracts): 56 chars
  if (/^C[A-Z2-7]{55}$/.test(a)) return true;
  return false;
}
