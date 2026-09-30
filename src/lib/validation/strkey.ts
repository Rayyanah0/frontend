// Stellar StrKey (SEP-23) validation, dependency-free so it runs identically
// in the browser, in workers and in Jest (where @stellar/stellar-sdk is mocked).
//
// Layout: base32( versionByte ‖ payload(32) ‖ crc16xmodem(versionByte ‖ payload) little-endian )
//   G… ed25519 public key (account)   version 6  << 3
//   C… contract                        version 2  << 3
//   S… ed25519 secret seed             version 18 << 3   (never valid as an address input)

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const STRKEY_VERSION = {
  account: 6 << 3,
  contract: 2 << 3,
  seed: 18 << 3,
} as const;
export type StrKeyKind = keyof typeof STRKEY_VERSION;

export function crc16xmodem(bytes: Uint8Array): number {
  let crc = 0x0000;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function base32Decode(input: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // Non-zero leftover bits ⇒ non-canonical encoding.
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) return null;
  return Uint8Array.from(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Encode a 32-byte payload (tests / fixtures). */
export function encodeStrKey(kind: StrKeyKind, payload: Uint8Array): string {
  if (payload.length !== 32) throw new Error("payload must be 32 bytes");
  const body = new Uint8Array(33);
  body[0] = STRKEY_VERSION[kind];
  body.set(payload, 1);
  const crc = crc16xmodem(body);
  const full = new Uint8Array(35);
  full.set(body);
  full[33] = crc & 0xff;
  full[34] = crc >> 8;
  return base32Encode(full);
}

export type StrKeyError = "empty" | "length" | "charset" | "version" | "checksum" | "secret";

/** Validate a strkey of the expected kind. Never trims — callers decide about whitespace. */
export function checkStrKey(input: string, kind: Exclude<StrKeyKind, "seed">): { ok: true } | { ok: false; error: StrKeyError } {
  if (input.length === 0) return { ok: false, error: "empty" };
  if (input[0] === "S" && /^[A-Z2-7]{56}$/.test(input)) return { ok: false, error: "secret" };
  if (input.length !== 56) return { ok: false, error: "length" };
  if (!/^[A-Z2-7]+$/.test(input)) return { ok: false, error: "charset" };
  const bytes = base32Decode(input);
  if (!bytes || bytes.length !== 35) return { ok: false, error: "length" };
  if (bytes[0] !== STRKEY_VERSION[kind]) return { ok: false, error: "version" };
  const expected = crc16xmodem(bytes.subarray(0, 33));
  const actual = bytes[33] | (bytes[34] << 8);
  if (expected !== actual) return { ok: false, error: "checksum" };
  return { ok: true };
}

export const isValidAccountId = (s: string) => checkStrKey(s, "account").ok;
export const isValidContractId = (s: string) => checkStrKey(s, "contract").ok;
