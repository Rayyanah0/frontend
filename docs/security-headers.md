# Content Security Policy and security headers (#117)

`src/middleware.ts` runs on every document and API request. It generates a
128-bit nonce, builds the policy from validated config
(`src/lib/security/csp.ts`), and sets:

| Header | Value |
|---|---|
| `Content-Security-Policy` (or `-Report-Only`) | see below |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (production only; preload-ready) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation, payment, serial, bluetooth, browsing-topics off; `usb`/`hid` self (Ledger); `clipboard-write` self |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` (wallet popups such as Albedo use `window.opener`) |
| `X-Frame-Options` | `DENY` (not sent on embed routes) |
| `Reporting-Endpoints` | `csp-endpoint="/api/csp-report"` |

## Policy

```
default-src 'self';
script-src 'nonce-<per request>' 'strict-dynamic' 'self' https:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' <API> <API as ws(s)> <Soroban RPC> <Horizon> [NEXT_PUBLIC_MONITOR_URL] [CSP_EXTRA_CONNECT_SRC];
worker-src 'self' blob:;  manifest-src 'self';  frame-src 'self' [CSP_EXTRA_FRAME_SRC];
frame-ancestors 'none';            # CSP_EMBED_ANCESTORS (default 'self') on /stats/embed
object-src 'none';  base-uri 'none';  form-action 'self';
report-uri /api/csp-report;  report-to csp-endpoint;  upgrade-insecure-requests (enforce, prod)
```

- **Origins come from config.** The origins in `connect-src` are derived from
  `NEXT_PUBLIC_API_URL` and from `NETWORKS[active]` in
  `src/lib/soroban/networks.ts`, the same values the app uses to connect.
  Every value is parsed with `new URL()`. An invalid or non-http(s)/ws(s)
  value throws, so the server fails closed instead of widening the policy.
- **Scripts.** Next.js reads the nonce from the forwarded request header and
  adds it to its framework and inline scripts. `'strict-dynamic'` lets those
  scripts load the rest of the chunks. `'self' https:` is ignored by CSP3
  browsers and is only a CSP2 fallback. Development adds `'unsafe-eval'`
  (React Refresh) and localhost `connect-src`.
- **Styles.** Tailwind compiles to a same-origin stylesheet. `next/font`
  self-hosts fonts (`font-src 'self'`) and inlines `@font-face` in a `<style>`
  tag. The codebase uses React `style={}` attributes extensively, and a nonce
  can't cover those, so `style-src` keeps `'unsafe-inline'`. Style injection
  is a much weaker primitive than script injection. Moving inline styles to
  classes would allow dropping it.
- **Wallets.** Freighter and other extensions inject content scripts, which
  are not subject to the page's CSP. Wallet-kit modals are same-origin web
  components. Popup wallets need COOP `same-origin-allow-popups`. Iframe
  wallets go in `CSP_EXTRA_FRAME_SRC`.
- **Analytics and monitoring.** Sentry goes through the same-origin tunnel
  (`/api/sentry-tunnel`), so no Sentry origin is needed. There is no
  third-party analytics script. If one is added, give it the nonce
  (`<Script nonce={nonce}>` in the layout) and add its origin to
  `CSP_EXTRA_CONNECT_SRC`.

## Rollout

1. Deploy with `CSP_MODE` unset. This sends `Content-Security-Policy-Report-Only`.
2. Watch `csp-violation …` events in monitoring. `/api/csp-report` accepts
   both `application/csp-report` and `application/reports+json`, drops
   violations from browser extensions, and redacts query strings.
3. Once reports are clean across Freighter, the wallet kit, fonts, and the
   PWA, set `CSP_MODE=enforce`.

## Rendering impact (ISR and static pages)

A nonce has to be unique per response, so it can't live in prerendered HTML.
The root layout reads `headers()`, which makes **every page dynamically
rendered**. There is no static optimisation and no ISR for HTML. Hashed
`/_next/static` assets are unaffected: they skip the middleware, stay
immutable, and are CDN-cacheable. They get `nosniff` and CORP from
`next.config.js`. All current pages are client-rendered terminals behind
live data, so the cost is one server render per navigation.

If a page ever needs to be static, such as a marketing page, exclude it in
the middleware matcher and give it a hash-based policy. List the `sha256-…`
of each inline script in a static `headers()` entry in `next.config.js`.
Do not fall back to `'unsafe-inline'`.

## Environment

| Variable | Purpose |
|---|---|
| `CSP_MODE` | `enforce` to enforce; anything else means report-only |
| `CSP_EXTRA_CONNECT_SRC` | Extra connect origins (comma or space separated) |
| `CSP_EXTRA_FRAME_SRC` | Extra frame origins (iframe wallets) |
| `CSP_EMBED_ANCESTORS` | `frame-ancestors` for `/stats/embed` (default `'self'`) |

## Verification

- `src/lib/security/__tests__/csp.test.ts`: policy builder, config validation, and report parsing.
- `tests/e2e/security-headers.spec.ts` (Playwright): headers present on
  every page, a unique nonce applied to Next's scripts, zero violations on
  load, an injected inline `<script>` and an `onerror` handler blocked, embed
  framing allowed, and the report endpoint working.
- After deploying, run securityheaders.com and
  [csp-evaluator](https://csp-evaluator.withgoogle.com) against the
  deployment and attach the reports to the PR.
