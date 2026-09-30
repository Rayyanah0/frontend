# Subresource Integrity & Third-Party Script Policy

**Status:** Active  
**Last reviewed:** 2026-09-29  
**Next review due:** 2027-03-29  
**Owner:** Platform / Security

---

## Table of contents

1. [Overview](#1-overview)
2. [Threat model](#2-threat-model)
3. [Third-party origin inventory](#3-third-party-origin-inventory)
4. [Enforcement mechanisms](#4-enforcement-mechanisms)
5. [SRI pinning procedure](#5-sri-pinning-procedure)
6. [Partytown / worker isolation (future work)](#6-partytown--worker-isolation-future-work)
7. [CSP Level 3 `require-sri-for` directive](#7-csp-level-3-require-sri-for-directive)
8. [Developer guidelines for new third-party dependencies](#8-developer-guidelines-for-new-third-party-dependencies)
9. [Review cadence](#9-review-cadence)

---

## 1. Overview

Zenith loads financial data, executes simulated trades, and handles wallet authentication. A single injected or tampered script can exfiltrate bearer tokens, manipulate displayed prices, or redirect signing prompts to a malicious endpoint. This document defines how the project manages risk from third-party script and stylesheet loading via:

- maintaining a minimal, explicit inventory of allowed external origins,
- enforcing Subresource Integrity (SRI) attributes on any external resource that cannot be self-hosted,
- running an automated CI scan that fails the build when an unpinned external resource is detected in the compiled output.

**SRI in one sentence:** an `integrity` attribute containing a cryptographic hash lets the browser refuse to execute a script (or apply a stylesheet) if the fetched bytes do not match the hash recorded at build time — making CDN compromise or MITM silent no longer.

---

## 2. Threat model

### 2.1 CDN compromise

A third-party CDN serving a popular library (`cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`, etc.) is a high-value attack target. A successful compromise allows an attacker to:

- replace a script with a version that exfiltrates form inputs or `localStorage` contents (bearer tokens, wallet addresses),
- inject a fake trade-confirmation dialog,
- silently modify displayed option prices.

SRI makes CDN compromise ineffective: the browser will block the modified script before it runs because its hash will not match the pinned value.

### 2.2 Supply-chain attacks via npm → CDN re-publishing

Several CDNs auto-publish every npm package version. A malicious publish to npm (typosquatting, dependency confusion, or a maintainer account takeover) can propagate to a CDN within minutes. SRI prevents a newly published malicious version from executing in users' browsers even if the CDN URL remains unchanged — because the hash in your HTML still points to the known-good version.

### 2.3 DNS / BGP hijacking

An attacker who can redirect DNS for an external domain (or hijack a BGP prefix) can serve a malicious response for any URL, including one your page loads. SRI mitigates this because the hash check is performed by the browser against the actual bytes, independent of the transport origin.

### 2.4 Man-in-the-middle on non-HSTS origins

If a page is loaded over HTTPS but an external dependency is fetched from an origin that doesn't enforce HSTS, an active network attacker can downgrade that sub-request. SRI prevents the substituted bytes from running.

### 2.5 What SRI does NOT protect against

| Threat | SRI protection? | Mitigation |
|---|---|---|
| Malicious code in the npm package itself (pre-bundled into your JS) | ✗ | `npm audit`, Dependabot, Trivy (already in CI) |
| Exfiltration via an already-trusted script | ✗ | CSP `connect-src` allowlist, network egress controls |
| Compromised first-party CDN / self-hosted origin | ✗ | Code signing, deployment integrity checks |
| XSS that modifies your own DOM after load | ✗ | CSP `script-src 'strict-dynamic'`, input sanitisation |

---

## 3. Third-party origin inventory

The table below is the authoritative record of every external origin this application is permitted to reference at runtime. It must be updated whenever a new dependency that loads from an external origin is introduced (see [section 8](#8-developer-guidelines-for-new-third-party-dependencies)).

| Origin | Purpose | Self-hosted? | SRI required | Notes |
|---|---|---|---|---|
| `fonts.googleapis.com` / `fonts.gstatic.com` | Web fonts | **Yes** (via `next/font`) | N/A — not loaded | `next/font` downloads font files at build time and serves them from the same origin. No runtime request to Google Fonts is made. This is the preferred pattern. |
| `sentry.io` | Error & performance monitoring | **Yes** (proxied) | N/A — not loaded | Sentry events are routed through the Next.js tunnel endpoint `/api/sentry-tunnel` (`tunnel:` option in `sentry.client.config.ts`). The browser never makes a direct request to `sentry.io`. The `@sentry/nextjs` package is bundled at build time — no CDN loading. |
| Any external CDN (`cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`, etc.) | — | — | — | **None identified.** No pages in this application reference an external CDN URL for scripts or stylesheets. The `scripts/check-external-scripts.mjs` CI scan enforces this continuously. |

**Current external request surface from the browser: zero external origins.**

All fonts are self-hosted, all monitoring is self-proxied, and all JavaScript is bundled by Next.js. The browser communicates only with:
- the application's own origin,
- the backend API origin (configured via `NEXT_PUBLIC_API_URL`), and
- the Stellar Horizon / Soroban RPC (server-side only, not from the browser bundle).

---

## 4. Enforcement mechanisms

### 4.1 `scripts/check-external-scripts.mjs` CI scan

The project includes a post-build scanner that walks the `.next/` output directory, finds every HTML file, and fails with exit code 1 if any `<script src="…">` or `<link href="…">` tag references an external origin without an `integrity=` attribute.

```
Usage: node scripts/check-external-scripts.mjs [options]

Options:
  --html-dir <dir>        Directory to scan (default: .next)
  --allow-origins <list>  Comma-separated origins to explicitly allow (e.g. for
                          a self-operated CDN with a separate SRI policy)
  -h, --help              Show help
```

The npm script alias is:

```bash
npm run sri:check
```

**Behaviour summary:**

| Situation | Exit code |
|---|---|
| No HTML files found (build hasn't run yet) | `0` with a warning — does not block pre-build CI steps |
| All external resources have `integrity=` | `0` |
| At least one external resource lacks `integrity=` | `1` — prints file path, URL, and partial tag to stderr |
| Origin is in `--allow-origins` list | treated as allowed (no `integrity=` required) |

The `--allow-origins` escape hatch exists for organisations operating their own CDN with a separate SRI policy. It must not be used to silence violations for third-party CDNs.

### 4.2 Adding the scan to CI

The `ci.yml` workflow is currently empty. Add a dedicated SRI check job that runs **after** the Next.js build so the `.next/` output is available:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-and-check:
    name: Build & SRI check
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          NEXT_PUBLIC_API_URL: http://localhost:8081
          NEXT_PUBLIC_STELLAR_NETWORK: testnet
          NEXT_PUBLIC_CONTRACT_ID: placeholder

      - name: SRI / external-script check
        run: npm run sri:check

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npm test
```

Placing `sri:check` immediately after `build` means it runs on every PR and on every push to `main`, before images are built or deployments proceed.

### 4.3 CSP header configuration in `next.config.js`

A Content Security Policy that restricts `script-src` and `style-src` to `'self'` (plus `'strict-dynamic'` for Next.js's inline bootstrap) is the runtime complement to SRI. Even if a script tag were somehow injected into the HTML, the browser would refuse to load it from an external origin.

Add the following to `next.config.js`. Adjust the `connect-src` allowlist to match your deployment's API origin:

```js
// next.config.js
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      // Scripts: only same-origin and Next.js inline scripts (nonce-based or
      // strict-dynamic). No external CDNs. 'unsafe-eval' is required by some
      // Next.js internals in dev; remove in production if possible.
      "script-src 'self' 'strict-dynamic'",

      // Styles: only same-origin. Next.js inlines some critical CSS; add
      // 'unsafe-inline' only if Next.js requires it, and track the issue.
      "style-src 'self' 'unsafe-inline'",

      // Fonts: self-hosted via next/font, served from same origin.
      "font-src 'self'",

      // Images: same-origin + data URIs for inline SVGs.
      "img-src 'self' data:",

      // API calls, WebSocket (WS/WSS), and Sentry tunnel (same-origin proxy).
      // Replace <api-origin> with the real backend URL in production.
      "connect-src 'self' <api-origin> wss://<api-origin>",

      // No plugins, frames, or object embeds.
      "object-src 'none'",
      "frame-ancestors 'none'",

      // Require HTTPS for all sub-resources.
      "upgrade-insecure-requests",
    ].join("; "),
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  // ... rest of your config
};

export default nextConfig;
```

> **Note on `'unsafe-inline'` for styles:** Next.js 14 injects critical CSS inline at SSR time. Until the project migrates to a nonce-based approach or a CSS-in-JS solution that supports strict CSP, `'unsafe-inline'` is required for `style-src`. This is an acceptable trade-off given that the primary XSS vector (script injection) is fully mitigated by the `script-src` policy. Track removal of `'unsafe-inline'` as a future hardening task.

---

## 5. SRI pinning procedure

If a future dependency requires loading a resource from an external origin (and self-hosting is not feasible), follow this procedure to pin it with SRI.

### 5.1 Compute the hash

Download the file you intend to load, then compute a SHA-384 hash and base64-encode it:

```bash
# Download the file
curl -fsSL https://cdn.example.com/library@1.2.3/dist/library.min.js \
  -o library.min.js

# Compute the SRI hash
openssl dgst -sha384 -binary library.min.js | openssl base64 -A
```

This produces a base64 string such as:

```
H8BRh8j48O9oYatfu5AZzq6A9RINhZO5H16dQZngK7T62td8uzkzekdBSsk=
```

Prefix it with `sha384-` to get the full integrity value:

```
sha384-H8BRh8j48O9oYatfu5AZzq6A9RINhZO5H16dQZngK7T62td8uzkzekdBSsk=
```

You can also generate the hash in a single pipeline (useful in scripts):

```bash
curl -fsSL https://cdn.example.com/library@1.2.3/dist/library.min.js \
  | openssl dgst -sha384 -binary \
  | openssl base64 -A \
  | sed 's/^/sha384-/'
```

### 5.2 Verify the hash round-trips

Before committing, verify that the hash you computed matches what the browser will see by running the same command again and comparing outputs, or by using a tool such as [srihash.org](https://www.srihash.org) on a locally saved copy.

### 5.3 Add `integrity` and `crossorigin` attributes

Both attributes are required. `crossorigin="anonymous"` tells the browser to make a CORS request without credentials; this is mandatory for SRI to work on cross-origin resources.

**In HTML:**

```html
<script
  src="https://cdn.example.com/library@1.2.3/dist/library.min.js"
  integrity="sha384-H8BRh8j48O9oYatfu5AZzq6A9RINhZO5H16dQZngK7T62td8uzkzekdBSsk="
  crossorigin="anonymous"
></script>

<link
  rel="stylesheet"
  href="https://cdn.example.com/library@1.2.3/dist/library.min.css"
  integrity="sha384-<hash-of-the-css-file>"
  crossorigin="anonymous"
/>
```

**In a Next.js `Script` component:**

```tsx
import Script from "next/script";

<Script
  src="https://cdn.example.com/library@1.2.3/dist/library.min.js"
  integrity="sha384-H8BRh8j48O9oYatfu5AZzq6A9RINhZO5H16dQZngK7T62td8uzkzekdBSsk="
  crossOrigin="anonymous"
  strategy="beforeInteractive"
/>
```

### 5.4 Record the new origin in the inventory

Update the [third-party origin inventory table](#3-third-party-origin-inventory) with the new origin, its purpose, and whether it is self-hosted. If it is not self-hosted, mark "SRI required: Yes" and include the pinned version in the Notes column.

### 5.5 Re-run the check

```bash
npm run build && npm run sri:check
```

The scan must exit 0 before the PR is merged.

### 5.6 Hash rotation on version bumps

When you upgrade a pinned external dependency to a new version, you must:

1. Download the new version's file.
2. Recompute the hash using the steps above.
3. Update the `integrity=` attribute in the HTML/component.
4. Update the inventory table with the new version.
5. Run `npm run build && npm run sri:check` to confirm the output is clean.

Pin hashes to a specific version URL (include the version number in the URL path). Never pin to a `latest` or floating URL — the hash would become stale the moment the CDN updates the file.

---

## 6. Partytown / worker isolation (future work)

[Partytown](https://partytown.builder.io/) is a library that relocates third-party scripts into a Web Worker. The main thread is isolated from the third-party script's execution context, limiting the blast radius of a compromised or misbehaving script (it cannot directly access `document`, `window.localStorage`, or other sensitive globals — it communicates via a proxied, synchronous bridge).

### Trade-off analysis

| Dimension | Benefit | Cost / risk |
|---|---|---|
| Main-thread isolation | Third-party script cannot directly read `localStorage`, intercept DOM events, or modify the DOM — it must go through a controlled bridge | The bridge itself adds complexity and a new attack surface |
| Performance | Offloads third-party execution to a Worker, freeing the main thread | Synchronous DOM access from the Worker is emulated via `SharedArrayBuffer`/`Atomics`, which requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers (breaking some third-party iframes and `postMessage` flows) |
| COEP/COOP requirement | Enforces a stricter isolation model for the whole page | May break the Freighter wallet extension's `postMessage`-based connection (needs investigation) |
| Maintenance | Actively maintained by Builder.io | Adds a build-time dependency and service worker configuration |
| Sentry compatibility | Sentry provides a Partytown-compatible build | The existing `/api/sentry-tunnel` proxy already eliminates Sentry as an external-origin risk; Partytown adds no marginal benefit for Sentry specifically |

### Current position

Partytown is **not implemented**. Given that Zenith currently loads zero third-party scripts from external origins, Partytown offers no immediate security benefit and introduces non-trivial risk to the Freighter wallet integration (which depends on `window.postMessage`).

### Recommended path

Revisit Partytown if and when:

1. A third-party analytics or A/B testing script that cannot be self-proxied is introduced.
2. Freighter compatibility with COOP/COEP is confirmed (test via a staging environment with headers set).
3. The team has capacity to write Playwright tests covering the Partytown service worker path.

---

## 7. CSP Level 3 `require-sri-for` directive

The `require-sri-for` directive is a CSP Level 3 proposal that instructs the browser to require an `integrity` attribute on all `<script>` or `<style>` elements (or both), regardless of their origin.

```
Content-Security-Policy: require-sri-for script style
```

### Current browser support

As of 2026, `require-sri-for` is **not widely supported**. It was removed from the CSP Level 3 specification draft due to implementation concerns and is not shipped in any major browser by default. Do not rely on it as a primary control.

| Browser | Support |
|---|---|
| Chrome / Edge | Removed from intent-to-ship; not available |
| Firefox | Behind a flag; not enabled by default |
| Safari | Not implemented |

### Recommended posture

Use `require-sri-for` as a **defence-in-depth layer**, not as a substitute for:

- the `scripts/check-external-scripts.mjs` CI scan (which catches violations at build time), or
- a strict `script-src 'self' 'strict-dynamic'` policy (which prevents execution of any un-allowed script origin at runtime).

Add it to your CSP anyway — on browsers that do support it, it provides an extra runtime check:

```js
// In the CSP header array in next.config.js:
{
  key: "Content-Security-Policy",
  value: [
    "script-src 'self' 'strict-dynamic'",
    "style-src 'self' 'unsafe-inline'",
    "require-sri-for script",   // defence-in-depth; ignored by unsupporting browsers
    // …
  ].join("; "),
},
```

Monitor the [MDN compatibility table](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/require-sri-for#browser_compatibility) and the [CSP specification changelog](https://www.w3.org/TR/CSP3/) for reinstatement.

---

## 8. Developer guidelines for adding new third-party dependencies

Follow this decision tree when you want to load a resource from a third-party origin at runtime.

### Step 1: Can it be bundled?

If the dependency is an npm package, **bundle it**. Next.js will include it in the application bundle. No external CDN loading, no SRI management, no cross-origin CORS negotiation. This is the default and preferred approach for all JavaScript dependencies.

### Step 2: Can it be self-hosted / self-proxied?

If the dependency must load at runtime (e.g., a tag manager, analytics pixel, or A/B testing SDK), evaluate whether it can be:

- **Downloaded and served from your own origin** — copy the file into `public/`, commit it, and reference it with a relative URL. Update it manually on each new version.
- **Proxied through a Next.js API route** — as done with Sentry (`/api/sentry-tunnel`). Your domain makes the outbound request; the browser never contacts the third party.
- **Loaded via `next/font`** — for web fonts, always use `next/font`. It downloads font files at build time and serves them from your origin.

Self-hosting / self-proxying eliminates the external-origin risk entirely and is always preferred over SRI pinning.

### Step 3: If external loading is unavoidable, pin with SRI

If you have exhausted steps 1 and 2 and the resource must be loaded from an external CDN:

1. Follow the full [SRI pinning procedure](#5-sri-pinning-procedure).
2. Open a PR that includes:
   - the updated `integrity=` and `crossorigin=` attributes in the component or HTML template,
   - an updated row in the [third-party origin inventory table](#3-third-party-origin-inventory),
   - an updated `connect-src` entry in the CSP header configuration (for scripts that make their own network requests),
   - passing output of `npm run build && npm run sri:check`.
3. Tag the PR with the `security` label for mandatory review by a second engineer.

### Step 4: Update the CSP

Whenever a new external origin is added, update the `Content-Security-Policy` header in `next.config.js` to explicitly allow it in the appropriate directive (`script-src`, `style-src`, `font-src`, or `connect-src`). A CSP that does not cover the new origin will cause the browser to block the resource even if SRI is correct.

### Quick reference checklist

```
[ ] Evaluated bundling via npm — not feasible because: ___
[ ] Evaluated self-hosting / self-proxying — not feasible because: ___
[ ] SHA-384 hash computed from the exact versioned URL
[ ] integrity= and crossorigin="anonymous" added to the tag
[ ] Third-party origin inventory table updated
[ ] CSP header updated (connect-src / script-src / style-src as appropriate)
[ ] npm run build && npm run sri:check exits 0
[ ] PR labelled "security", second-engineer review requested
```

---

## 9. Review cadence

| Activity | Frequency | Owner |
|---|---|---|
| Automated CI scan (`npm run sri:check`) | Every push / PR | CI (automated) |
| Third-party origin inventory review | Every 6 months or after any new external dependency is added | Platform / Security |
| CSP header audit (check for unnecessary `'unsafe-*'` sources, tighten allowlists) | Every 6 months | Platform / Security |
| SRI hash rotation for any pinned external resources | On every version bump of the pinned dependency | Engineer making the upgrade |
| Full policy document review | Every 12 months or after a significant architecture change | Platform / Security |
| Browser support re-check for `require-sri-for` | Every 12 months | Platform / Security |

**Next scheduled review:** 2027-03-29

---

*This document lives at `docs/security/sri-policy.md`. Propose changes via pull request with the `security` label.*
