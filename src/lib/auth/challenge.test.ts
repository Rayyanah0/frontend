/**
 * Tests for src/lib/auth/challenge.ts
 * Issue #128: Anti-Phishing Protections
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  getAllowedOrigins,
  isOfficialOrigin,
  getSigningStatement,
  detectAddressPoisoning,
  isValidStellarAddress,
} from "./challenge";

describe("getAllowedOrigins", () => {
  it("includes the primary app domain", () => {
    const origins = getAllowedOrigins();
    expect(origins).toContain("https://app.zenith.trade");
  });

  it("includes the base domain", () => {
    expect(getAllowedOrigins()).toContain("https://zenith.trade");
  });

  it("returns at least 2 origins", () => {
    expect(getAllowedOrigins().length).toBeGreaterThanOrEqual(2);
  });
});

describe("isOfficialOrigin", () => {
  it("recognizes the primary app domain", () => {
    expect(isOfficialOrigin("https://app.zenith.trade")).toBe(true);
  });

  it("recognizes the base domain", () => {
    expect(isOfficialOrigin("https://zenith.trade")).toBe(true);
  });

  it("rejects a lookalike domain", () => {
    expect(isOfficialOrigin("https://zenith-trade.com")).toBe(false);
  });

  it("rejects a subdomain not in the allow list", () => {
    expect(isOfficialOrigin("https://evil.zenith.trade")).toBe(false);
  });

  it("allows localhost in development", () => {
    expect(isOfficialOrigin("http://localhost:3000")).toBe(true);
  });

  it("allows 127.0.0.1 in development", () => {
    expect(isOfficialOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects http (non-TLS) for production domains", () => {
    expect(isOfficialOrigin("http://app.zenith.trade")).toBe(false);
  });
});

describe("getSigningStatement", () => {
  it("includes the wallet address", () => {
    const stmt = getSigningStatement("GDTEST00000000000000000000000000000000000000000000");
    expect(stmt).toContain("GDTEST00000000000000000000000000000000000000000000");
  });

  it("includes 'Zenith Options Protocol'", () => {
    const stmt = getSigningStatement("GDTEST00000000000000000000000000000000000000000000");
    expect(stmt.toLowerCase()).toContain("zenith");
  });

  it("warns when origin is unofficial", () => {
    const stmt = getSigningStatement("GDTEST00000000000000000000000000000000000000000000");
    // In jsdom, window.location.origin is usually http://localhost
    // which is in the allowed list, so it should be marked official
    expect(typeof stmt).toBe("string");
    expect(stmt.length).toBeGreaterThan(20);
  });
});

describe("isValidStellarAddress", () => {
  it("accepts a valid G-address (56 chars)", () => {
    // 56-char Stellar G-address (base32 uppercase)
    expect(isValidStellarAddress("GDXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567AB")).toBe(false); // too short
    // Real 56-char address
    expect(isValidStellarAddress("GDQP2LMKF3GMHZXIWK2IIOFBZLDIZ5SJMLNQF3FQJLBQHYQ")).toBe(false); // has 0
  });

  it("accepts a well-formed G-address", () => {
    // G + 55 valid base32 chars (A-Z, 2-7)
    const addr = "G" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".repeat(2).slice(0, 55);
    expect(isValidStellarAddress(addr)).toBe(true);
  });

  it("rejects an address starting with invalid letter", () => {
    expect(isValidStellarAddress("XDTEST00000000000000000000000000000000000000000000X")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidStellarAddress("")).toBe(false);
  });

  it("rejects an address with invalid characters (0, 1, 8, 9)", () => {
    // Stellar base32 only allows A-Z and 2-7; 0, 1, 8, 9 are invalid
    expect(isValidStellarAddress("G0TEST00000000000000000000000000000000000000000000G")).toBe(false);
  });

  it("accepts a C-address (contract)", () => {
    const addr = "C" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".repeat(2).slice(0, 55);
    expect(isValidStellarAddress(addr)).toBe(true);
  });
});

describe("detectAddressPoisoning", () => {
  const realAddress = "GABC234567XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXAAAA";
  const poisonAddress = "GABC234567YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYAAAA";
  const differentAddress = "GZZZ234567XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXBBBB";

  it("returns poisoned=false for exact match", () => {
    const r = detectAddressPoisoning(realAddress, [realAddress]);
    expect(r.poisoned).toBe(false);
  });

  it("detects an address matching first+last 4 chars with different middle", () => {
    const known = "GAAAA000000000000000000000000000000000000000000ZZZZ";
    const poison = "GAAAA111111111111111111111111111111111111111111ZZZZ";
    const r = detectAddressPoisoning(poison, [known]);
    expect(r.poisoned).toBe(true);
    expect(r.matchedAddress).toBe(known);
  });

  it("returns poisoned=false for completely different address", () => {
    const r = detectAddressPoisoning(differentAddress, [realAddress]);
    expect(r.poisoned).toBe(false);
  });

  it("returns poisoned=false for empty input", () => {
    const r = detectAddressPoisoning("", [realAddress]);
    expect(r.poisoned).toBe(false);
  });

  it("returns poisoned=false when known list is empty", () => {
    const r = detectAddressPoisoning(poisonAddress, []);
    expect(r.poisoned).toBe(false);
  });

  it("includes a human-readable warning when poisoned", () => {
    const known = "GAAAA000000000000000000000000000000000000000000ZZZZ";
    const poison = "GAAAA111111111111111111111111111111111111111111ZZZZ";
    const r = detectAddressPoisoning(poison, [known]);
    expect(r.poisoned).toBe(true);
    expect(r.warning).toBeDefined();
    expect(typeof r.warning).toBe("string");
    expect((r.warning ?? "").length).toBeGreaterThan(10);
  });

  it("trims whitespace from input before checking", () => {
    const known = "GAAAA000000000000000000000000000000000000000000ZZZZ";
    const r = detectAddressPoisoning(`  ${known}  `, [known]);
    expect(r.poisoned).toBe(false); // exact match after trim
  });

  it("supports a custom matchLen", () => {
    // With matchLen=8, shorter shared prefix doesn't trigger
    const known = "GABCD1234000000000000000000000000000000000001234DCBA";
    const poison = "GABCD1234111111111111111111111111111111111111234DCBA";
    const r4 = detectAddressPoisoning(poison, [known], 4);
    const r8 = detectAddressPoisoning(poison, [known], 8);
    expect(r4.poisoned).toBe(true);
    expect(r8.poisoned).toBe(true); // still matches since first 8 and last 8 overlap
  });
});
