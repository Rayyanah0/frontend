// Stellar StrKey validation — pure, dependency-free.
//
// The wizard lets users paste contract (`C…`) and account (`G…`) addresses into
// argument forms, so we need real validation rather than a length check.  The
// Stellar SDK's StrKey is stubbed out under Jest (see __mocks__/stellarSdkMock.js)
// and this module is used on the client hot path anyway, so the canonical
// algorithm is implemented here.
//
// Reference: https://developers.stellar.org/docs/learn/fundamentals/encryption
//
// A StrKey is:
//   base32( version_byte || 32-byte ed25519 public key || crc16_xmodem(payload) )
// rendered with the RFC 4648 base32 alphabet and no padding.  That is always
// 56 characters.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Version byte for an ed25519 account (public) key — renders as a leading "G". */
export const STRKEY_VERSION_ACCOUNT = 6 << 3;

/** Version byte for a contract (contract instance) key — renders as a leading "C". */
export const STRKEY_VERSION_CONTRACT = 2 << 3;

/** Bytes in an ed25519 public key. */
const PUBLIC_KEY_BYTES = 32;

/** Total StrKey length: 33 payload bytes + 2 checksum bytes = 56 base32 chars. */
const STRKEY_LENGTH = 56;

/**
 * Decode base32 (RFC 4648, no padding) into bytes.
 * Returns null on any invalid character or impossible length.
 */
function base32Decode(input: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (let i = 0; i < input.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(input[i]);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }

  // Any leftover bits must be zero padding, never data.
  if (bits >= 5) return null;
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) return null;

  return Uint8Array.from(out);
}

/**
 * CRC16/XMODEM — the checksum Stellar uses for StrKey.
 * (poly 0x1021, init 0x0000, no reflection, no final xor)
 */
export function crc16xmodem(bytes: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** Why an address was rejected — used to drive precise form-level error text. */
export type AddressErrorCode =
  | "empty"
  | "wrong_length"
  | "bad_character"
  | "bad_version"
  | "bad_checksum";

export interface AddressValidation {
  ok: boolean;
  /** StrKey version byte when valid (48 = account, 16 = contract). */
  version?: number;
  error?: AddressErrorCode;
}

/**
 * Validate a Stellar StrKey address (account `G…` or contract `C…`).
 * Performs a full checksum verification — this catches single-character
 * typos that a length check would happily accept.
 */
export function validateStrKey(input: string): AddressValidation {
  const str = input.trim();
  if (str.length === 0) return { ok: false, error: "empty" };

  if (str.length !== STRKEY_LENGTH) return { ok: false, error: "wrong_length" };
  if (/[01]/.test(str) || /[^A-Z2-7]/.test(str)) return { ok: false, error: "bad_character" };

  const decoded = base32Decode(str);
  if (!decoded || decoded.length !== PUBLIC_KEY_BYTES + 3) return { ok: false, error: "bad_character" };

  const version = decoded[0];
  if (version !== STRKEY_VERSION_ACCOUNT && version !== STRKEY_VERSION_CONTRACT) {
    return { ok: false, error: "bad_version" };
  }

  // Checksum covers the first 33 bytes and is stored little-endian.
  const payload = decoded.slice(0, PUBLIC_KEY_BYTES + 1);
  const expected = crc16xmodem(payload);
  const actual = decoded[PUBLIC_KEY_BYTES + 1] | (decoded[PUBLIC_KEY_BYTES + 2] << 8);
  if (expected !== actual) return { ok: false, error: "bad_checksum" };

  return { ok: true, version };
}

export function isValidAccountAddress(input: string): boolean {
  const r = validateStrKey(input);
  return r.ok && r.version === STRKEY_VERSION_ACCOUNT;
}

export function isValidContractAddress(input: string): boolean {
  const r = validateStrKey(input);
  return r.ok && r.version === STRKEY_VERSION_CONTRACT;
}

/** Human-readable reason an address failed validation. */
export function describeAddressError(code: AddressErrorCode): string {
  switch (code) {
    case "empty":
      return "Address is required.";
    case "wrong_length":
      return "Stellar addresses are 56 characters.";
    case "bad_character":
      return "Only characters A–Z and 2–7 are allowed (base32).";
    case "bad_version":
      return "Not a Stellar address — expected an account (G…) or contract (C…) key.";
    case "bad_checksum":
      return "Checksum failed — check the address for a typo.";
  }
}
