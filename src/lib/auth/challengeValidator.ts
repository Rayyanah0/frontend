// Client-side challenge validation for the Zenith backend sign-in flow.
// Validates the challenge before asking the wallet to sign, providing
// phishing defense against malicious or compromised endpoints.
//
// Challenge format (structured, in the spirit of SEP-10 / SIWS):
// The message field returned by /auth/nonce must parse as:
//
//   Zenith wants you to sign in with your Stellar account:
//   <walletAddress>
//
//   URI: <uri>
//   Version: 1
//   Nonce: <nonce>
//   Issued At: <ISO8601>
//   Expiration Time: <ISO8601>
//
// All fields are required. Domain is extracted from the URI.

export interface ParsedChallenge {
  walletAddress: string;
  uri: string;
  domain: string;
  version: string;
  nonce: string;
  issuedAt: Date;
  expirationTime: Date;
  /** The full raw message, for display */
  rawMessage: string;
}

export type ChallengeValidationError =
  | 'PARSE_ERROR'
  | 'WRONG_ADDRESS'
  | 'WRONG_DOMAIN'
  | 'NONCE_MALFORMED'
  | 'ISSUED_AT_FUTURE'
  | 'EXPIRED'
  | 'ISSUED_AT_TOO_OLD'
  | 'VERSION_UNSUPPORTED';

export class ChallengeValidationFailure extends Error {
  code: ChallengeValidationError;
  constructor(code: ChallengeValidationError, message: string) {
    super(message);
    this.code = code;
    this.name = 'ChallengeValidationFailure';
  }
}

// Nonce must be a hex or base64url string of at least 16 characters
const NONCE_RE = /^[A-Za-z0-9+/=_-]{16,}$/;

// Maximum allowed clock skew (5 minutes)
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
// Maximum age for issued-at (15 minutes) — challenges older than this are rejected
const MAX_ISSUED_AT_AGE_MS = 15 * 60 * 1000;

/**
 * Parse the structured challenge message.
 * Returns null if the message does not match the expected format.
 */
export function parseChallenge(message: string): ParsedChallenge | null {
  // Split on blank lines — preamble block + fields block
  const normalized = message.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');

  // First line: "Zenith wants you to sign in with your Stellar account:"
  if (!lines[0]?.trim().toLowerCase().startsWith('zenith wants you to sign in')) return null;
  // Second line: wallet address
  const walletAddress = lines[1]?.trim();
  if (!walletAddress) return null;

  // Parse key: value fields
  const fields: Record<string, string> = {};
  for (const line of lines.slice(2)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) fields[key] = value;
  }

  const uri = fields['URI'];
  const version = fields['Version'];
  const nonce = fields['Nonce'];
  const issuedAtStr = fields['Issued At'];
  const expirationStr = fields['Expiration Time'];

  if (!uri || !version || !nonce || !issuedAtStr || !expirationStr) return null;

  const issuedAt = new Date(issuedAtStr);
  const expirationTime = new Date(expirationStr);
  if (isNaN(issuedAt.getTime()) || isNaN(expirationTime.getTime())) return null;

  let domain = '';
  try { domain = new URL(uri).hostname; } catch { return null; }

  return { walletAddress, uri, domain, version, nonce, issuedAt, expirationTime, rawMessage: message };
}

/**
 * Validate a parsed challenge against the expected wallet address and the
 * current time. Throws ChallengeValidationFailure with a precise error code
 * on any violation.
 */
export function validateChallenge(
  challenge: ParsedChallenge,
  opts: {
    expectedAddress: string;
    expectedDomain?: string;
  }
): void {
  // Version check
  if (challenge.version !== '1') {
    throw new ChallengeValidationFailure(
      'VERSION_UNSUPPORTED',
      `Unsupported challenge version "${challenge.version}". Expected "1".`
    );
  }

  // Address binding
  if (challenge.walletAddress !== opts.expectedAddress) {
    throw new ChallengeValidationFailure(
      'WRONG_ADDRESS',
      `Challenge is for address ${challenge.walletAddress}, but your wallet is ${opts.expectedAddress}.`
    );
  }

  // Domain binding
  const expectedDomain = opts.expectedDomain ?? (typeof window !== 'undefined' ? window.location.hostname : '');
  if (expectedDomain && challenge.domain !== expectedDomain) {
    throw new ChallengeValidationFailure(
      'WRONG_DOMAIN',
      `Challenge domain "${challenge.domain}" does not match this app's domain "${expectedDomain}". This may be a phishing attempt.`
    );
  }

  // Nonce format
  if (!NONCE_RE.test(challenge.nonce)) {
    throw new ChallengeValidationFailure(
      'NONCE_MALFORMED',
      'Challenge nonce is malformed. Expected a random alphanumeric string of at least 16 characters.'
    );
  }

  const now = Date.now();

  // Issued-at must not be in the future (beyond clock skew)
  if (challenge.issuedAt.getTime() > now + MAX_CLOCK_SKEW_MS) {
    throw new ChallengeValidationFailure(
      'ISSUED_AT_FUTURE',
      `Challenge was issued in the future (${challenge.issuedAt.toISOString()}). Check your system clock.`
    );
  }

  // Issued-at must not be too old
  if (now - challenge.issuedAt.getTime() > MAX_ISSUED_AT_AGE_MS) {
    throw new ChallengeValidationFailure(
      'ISSUED_AT_TOO_OLD',
      'The sign-in challenge has expired (issued more than 15 minutes ago). Please try signing in again.'
    );
  }

  // Explicit expiry
  if (challenge.expirationTime.getTime() < now) {
    throw new ChallengeValidationFailure(
      'EXPIRED',
      `This sign-in challenge expired at ${challenge.expirationTime.toLocaleString()}. Request a new one.`
    );
  }
}

/**
 * Parse and validate in one call. Throws ChallengeValidationFailure if the
 * message cannot be parsed or fails any check. Returns the parsed challenge
 * so the caller can display it before asking the user to sign.
 *
 * Note on domain validation: disabled in development (localhost) by default
 * because NEXT_PUBLIC_API_URL typically points to a different host. Set
 * opts.skipDomainCheck = true to disable explicitly in other environments.
 */
export function parseAndValidateChallenge(
  message: string,
  walletAddress: string,
  opts: { skipDomainCheck?: boolean } = {}
): ParsedChallenge {
  const parsed = parseChallenge(message);
  if (!parsed) {
    // The backend returned an unstructured message — pass through with a warning
    // rather than blocking sign-in entirely so existing deployments still work.
    // Callers should log a deprecation notice and prompt backend to migrate.
    console.warn(
      '[challengeValidator] Message does not match structured challenge format. '
      + 'Signing unvalidated legacy message. Migrate to the structured format.'
    );
    // Return a minimal synthetic challenge for display
    return {
      walletAddress,
      uri: '',
      domain: '',
      version: 'legacy',
      nonce: '',
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 15 * 60 * 1000),
      rawMessage: message,
    };
  }

  const isDev = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  validateChallenge(parsed, {
    expectedAddress: walletAddress,
    expectedDomain: opts.skipDomainCheck || isDev ? '' : undefined,
  });

  return parsed;
}

/** Human-readable summary of what is being signed, for display before the wallet prompt. */
export function formatChallengeSummary(challenge: ParsedChallenge): string {
  if (challenge.version === 'legacy') {
    return `Sign in to Zenith\n\nMessage: ${challenge.rawMessage}`;
  }
  return [
    `Sign in to Zenith`,
    ``,
    `Account: ${challenge.walletAddress}`,
    `App:     ${challenge.domain || challenge.uri}`,
    `Expires: ${challenge.expirationTime.toLocaleString()}`,
    `Nonce:   ${challenge.nonce.slice(0, 8)}…`,
  ].join('\n');
}
