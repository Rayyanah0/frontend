# Security Invariants — Zenith Frontend

## Issue #130: Security Regression Test Suite

---

## Introduction

Security invariants are properties of the system that must hold unconditionally, regardless of feature changes, refactors, or dependency upgrades. Encoding them as automated tests rather than prose documentation serves three purposes:

1. **Regression prevention.** A future commit that accidentally removes HTTPS enforcement, weakens nonce validation, or leaks tokens across wallet namespaces will fail CI immediately, with a named invariant ID pointing to the exact contract that was broken.

2. **Living specification.** The test file is the authoritative source of truth for each invariant. The table below cross-references it so reviewers can jump from requirement to implementation and back.

3. **Audit trail.** Each invariant has a stable ID (`SEC-NNN`). Security audits, vulnerability reports, and pull requests can reference these IDs without ambiguity. When an invariant is tightened or relaxed, the history of that change is visible in `git log` on both this file and the test.

All 23 invariants live in a single file so the entire suite can be run in isolation, with no dependency on a running backend or browser extension:

```bash
npm test src/test/security/invariants.test.ts
```

---

## Domain Definitions

| Domain | Abbreviation | Scope |
|---|---|---|
| **signing** | `signing` | Challenge/response authentication: parsing, field validation, expiry, origin binding, nonce entropy, version gating. Covers the Freighter sign-in flow (`src/lib/auth/challengeValidator.ts`). |
| **input** | `input` | User-supplied address validation. Specifically the address-poisoning heuristic that detects look-alike wallet addresses designed to fool copy-paste. |
| **session** | `session` | Bearer token lifecycle: where tokens are stored, that logout clears them completely, and that tokens never appear in URLs. |
| **isolation** | `isolation` | Per-wallet namespacing in `localStorage`. Alert rules, workspace layouts, and anti-phishing phrases must not bleed between wallet accounts. Hotkeys (non-sensitive) are explicitly documented as intentionally global. |
| **headers** | `headers` | Structural HTTP and subresource security: `X-Frame-Options`, SRI hash format correctness, and the HTTPS-only policy for external resources. |

---

## Invariants Table

| ID | Domain | Invariant Description | Test File | Test Name | Security / WCAG Ref |
|---|---|---|---|---|---|
| SEC-001 | signing | A well-formed, unexpired challenge for the correct address and domain parses and validates without throwing. | `src/test/security/invariants.test.ts` | `SEC-001: valid challenge parses and validates without error` | SIWS §3 (happy path) |
| SEC-002 | signing | A challenge issued to address A must be rejected with `WRONG_ADDRESS` when validated against address B. | `src/test/security/invariants.test.ts` | `SEC-002: challenge for wrong address is rejected (WRONG_ADDRESS)` | SIWS §4.2; prevents session fixation |
| SEC-003 | signing | A challenge whose `Expiration Time` field is in the past must be rejected with `EXPIRED`. | `src/test/security/invariants.test.ts` | `SEC-003: expired challenge is rejected (EXPIRED)` | SIWS §4.3; prevents replay attacks |
| SEC-004 | signing | A challenge whose `URI` field does not match the expected domain must be rejected with `WRONG_DOMAIN`. | `src/test/security/invariants.test.ts` | `SEC-004: challenge with mismatched domain is rejected (WRONG_DOMAIN)` | SIWS §4.4; prevents phishing relay |
| SEC-005 | signing | A challenge with a nonce shorter than the minimum entropy threshold must be rejected with `NONCE_MALFORMED`. | `src/test/security/invariants.test.ts` | `SEC-005: malformed nonce is rejected (NONCE_MALFORMED)` | OWASP Auth §3; prevents brute-force nonce guessing |
| SEC-006 | signing | A challenge whose `URI` field is not a valid HTTPS URL must not parse (returns `null`). | `src/test/security/invariants.test.ts` | `SEC-006: challenge URI must be a valid HTTPS URL` | SIWS §4.1; OWASP Transport Layer |
| SEC-007 | signing | A challenge with a `Version` field other than `"1"` must be rejected with `VERSION_UNSUPPORTED`. | `src/test/security/invariants.test.ts` | `SEC-007: challenge version other than '1' is rejected` | SIWS §4.5; prevents downgrade attacks |
| SEC-008 | signing | A challenge whose `Issued At` timestamp is more than 10 minutes in the past must be rejected with `ISSUED_AT_TOO_OLD`. | `src/test/security/invariants.test.ts` | `SEC-008: challenge issued too far in the past is rejected (ISSUED_AT_TOO_OLD)` | SIWS §4.3; limits replay window |
| SEC-009 | signing | A challenge whose `Issued At` timestamp is more than a few minutes in the future must be rejected with `ISSUED_AT_FUTURE`. | `src/test/security/invariants.test.ts` | `SEC-009: issued-at far in the future is rejected (ISSUED_AT_FUTURE)` | SIWS §4.3; prevents clock-skew abuse |
| SEC-010 | input | An address that exactly matches a known address must not be flagged as poisoned. | `src/test/security/invariants.test.ts` | `SEC-010: exact address match is not flagged as poisoned` | CWE-20 (false-positive control) |
| SEC-011 | input | An address that matches the first N and last N characters of a known address but differs in the middle must be flagged as poisoned. | `src/test/security/invariants.test.ts` | `SEC-011: address matching first+last chars but differing in middle is flagged` | CWE-20; address-poisoning attack pattern |
| SEC-012 | input | A completely different address (no prefix/suffix match) must not be flagged as poisoned. | `src/test/security/invariants.test.ts` | `SEC-012: completely different address is not flagged` | CWE-20 (false-positive control) |
| SEC-013 | input | An empty string input must not be flagged as poisoned. | `src/test/security/invariants.test.ts` | `SEC-013: empty input is not flagged` | CWE-20; null/empty input safety |
| SEC-014 | session | After explicit logout, all `zenith.wallet.*` keys must be absent from `localStorage`. | `src/test/security/invariants.test.ts` | `SEC-014: after explicit logout, no wallet key remains in localStorage` | OWASP Session Mgmt §3.3; WCAG 2.2 SC 3.3.8 |
| SEC-015 | session | Bearer tokens must never appear as URL query parameters (detectable by scanning constructed URLs for `token=`, `auth=`, or `bearer=`). | `src/test/security/invariants.test.ts` | `SEC-015: bearer token must not appear as a URL query parameter` | OWASP ASVS V3.4.2; tokens in URLs leak via Referer/logs |
| SEC-016 | session | `sessionStorage` must be empty immediately after a fresh page load — wallet tokens are stored only in the zustand-persist `localStorage` store. | `src/test/security/invariants.test.ts` | `SEC-016: sessionStorage is empty after a fresh page load simulation` | OWASP Session Mgmt §2.1 |
| SEC-017 | isolation | Alert rules must be stored under a per-wallet key (`zenith.rules.<address>`) so that switching wallets does not expose another wallet's rules. | `src/test/security/invariants.test.ts` | `SEC-017: rules are stored per wallet address and cannot bleed across wallets` | CWE-359; data isolation |
| SEC-018 | isolation | Workspace layouts must be stored under a per-wallet key (`zenith.layout.<address>`); a different wallet must see no layout data. | `src/test/security/invariants.test.ts` | `SEC-018: workspace layouts are keyed per wallet` | CWE-359; data isolation |
| SEC-019 | isolation | Hotkeys configuration (`zenith.hotkeys.v1`) is intentionally global (non-sensitive preference) and is explicitly documented as such, not a violation. | `src/test/security/invariants.test.ts` | `SEC-019: hotkeys config is not wallet-specific (safe global preference)` | N/A — documented exception |
| SEC-020 | isolation | Anti-phishing phrases must be stored under a per-wallet key (`zenith.antiphishing.phrase.<address>`) and must not be visible to a different wallet. | `src/test/security/invariants.test.ts` | `SEC-020: anti-phishing phrase is wallet-specific and survives wallet switch` | CWE-359; anti-phishing UX integrity |
| SEC-021 | headers | The Next.js config must not disable `X-Frame-Options`; it must remain set to `DENY` or `SAMEORIGIN`. | `src/test/security/invariants.test.ts` | `SEC-021: next.config must not disable X-Frame-Options` | OWASP Clickjacking Defense; RFC 7034 |
| SEC-022 | headers | Any SRI `integrity` attribute used in the app must match the format `sha(256\|384\|512)-<base64>` with at least 40 base64 characters. | `src/test/security/invariants.test.ts` | `SEC-022: SRI integrity attribute format is valid sha384 hash` | W3C SRI §4.2; OWASP ASVS V14.2.3 |
| SEC-023 | headers | All external resource URLs (CDN scripts, fonts, etc.) must use `https://`, never `http://`. | `src/test/security/invariants.test.ts` | `SEC-023: external script URLs must use HTTPS not HTTP` | OWASP Transport Layer §1; HSTS |

---

## Running the Suite

Run all 23 invariant tests in isolation:

```bash
npm test src/test/security/invariants.test.ts
```

Expected output (all passing):

```
 PASS  src/test/security/invariants.test.ts
  [signing] challenge validation (SEC-001..005)
    ✓ SEC-001: valid challenge parses and validates without error
    ✓ SEC-002: challenge for wrong address is rejected (WRONG_ADDRESS)
    ✓ SEC-003: expired challenge is rejected (EXPIRED)
    ✓ SEC-004: challenge with mismatched domain is rejected (WRONG_DOMAIN)
    ✓ SEC-005: malformed nonce is rejected (NONCE_MALFORMED)
  [signing] origin binding (SEC-006..009)
    ✓ SEC-006: challenge URI must be a valid HTTPS URL
    ✓ SEC-007: challenge version other than '1' is rejected
    ✓ SEC-008: challenge issued too far in the past is rejected (ISSUED_AT_TOO_OLD)
    ✓ SEC-009: issued-at far in the future is rejected (ISSUED_AT_FUTURE)
  [input] address poisoning detection (SEC-010..013)
    ✓ SEC-010: exact address match is not flagged as poisoned
    ✓ SEC-011: address matching first+last chars but differing in middle is flagged
    ✓ SEC-012: completely different address is not flagged
    ✓ SEC-013: empty input is not flagged
  [session] token storage invariants (SEC-014..016)
    ✓ SEC-014: after explicit logout, no wallet key remains in localStorage
    ✓ SEC-015: bearer token must not appear as a URL query parameter
    ✓ SEC-016: sessionStorage is empty after a fresh page load simulation
  [isolation] cross-wallet data isolation (SEC-017..020)
    ✓ SEC-017: rules are stored per wallet address and cannot bleed across wallets
    ✓ SEC-018: workspace layouts are keyed per wallet
    ✓ SEC-019: hotkeys config is not wallet-specific (safe global preference)
    ✓ SEC-020: anti-phishing phrase is wallet-specific and survives wallet switch
  [headers] SRI and structural security checks (SEC-021..023)
    ✓ SEC-021: next.config must not disable X-Frame-Options
    ✓ SEC-022: SRI integrity attribute format is valid sha384 hash
    ✓ SEC-023: external script URLs must use HTTPS not HTTP

Tests: 23 passed, 23 total
```

To run the full test suite (all unit tests):

```bash
npm test
```

---

## Adding New Invariants

1. **Assign the next ID.** IDs are sequential and never reused. Find the highest existing `SEC-NNN` in the table above and increment.

2. **Assign a domain.** Choose from `signing`, `input`, `session`, `isolation`, or `headers`. If the new invariant doesn't fit any existing domain, define a new one and add it to the [Domain Definitions](#domain-definitions) table above.

3. **Write the test.** Add it to `src/test/security/invariants.test.ts` inside the appropriate `describe` block (or a new one for a new domain). The test description must begin with the invariant ID: `"SEC-NNN: ..."`.

4. **Update this table.** Add a row with all six columns filled in. The `Security / WCAG Ref` column should cite at least one of: a CWE number, an OWASP guide section, a W3C spec reference, or a WCAG 2.2 Success Criterion.

5. **Keep the suite self-contained.** Invariant tests must not require a running backend, a real Freighter extension, or any network call. If the invariant requires external state, mock it.

6. **Verify CI is green.** Run `npm test src/test/security/invariants.test.ts` locally before opening the PR. The test file must stay at exactly one location so the CI `--grep SEC-` pattern continues to work.

> **Do not delete or renumber existing IDs.** If an invariant becomes obsolete, mark it `RETIRED` in the table and add a comment in the test explaining why it was removed, then delete only the test body (keeping the `it.skip` stub with the ID).

---

## Related Documents

- [docs/security/sri-policy.md](sri-policy.md) — Subresource Integrity policy: which external resources require SRI hashes, how hashes are generated and pinned, and the CI check that enforces them (directly related to SEC-022 and SEC-023).
- [docs/a11y/audit.md](../a11y/audit.md) — Accessibility audit results and remediation tracking. SEC-014 references WCAG 2.2 SC 3.3.8 (accessible authentication); that document tracks the broader WCAG compliance posture.

---

*Last updated: 2026-09-29 · Issue [#130](https://github.com/Zenith-options/frontend/issues/130)*
