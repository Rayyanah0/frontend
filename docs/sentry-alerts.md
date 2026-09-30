# Sentry Alert Rules

## Recommended alert rules for Zenith frontend

Configure these in your Sentry project under **Alerts → Alert Rules**.

### 1. Trade submission error spike

| Setting | Value |
|---|---|
| Condition | Number of errors with tag `context:trade-submit` > 5 in 10 min |
| Action | Notify `#alerts-trading` Slack channel |
| Priority | Critical |

Catches silent trade failures (the most user-impactful error type for a
trading app).

### 2. Chain load failure rate

| Setting | Value |
|---|---|
| Condition | Error rate for transaction `chain.load` > 20% over 5 min |
| Action | Notify on-call |
| Priority | High |

### 3. Unhandled exceptions spike (any)

| Setting | Value |
|---|---|
| Condition | Number of new issues > 3 in 5 min |
| Action | Notify `#alerts-frontend` |
| Priority | Medium |

### 4. Release regression

| Setting | Value |
|---|---|
| Condition | New issue introduced in the last release (auto-detected) |
| Action | Notify PR author + `#alerts-frontend` |
| Priority | High |

## Release health tracking

Releases are tagged with the git SHA via `NEXT_PUBLIC_SENTRY_RELEASE` in
the CI build (see `.github/workflows/ci.yml`).  Sentry will automatically
track crash-free session rate per release and notify if a release degrades
the crash-free rate by more than 5%.

## PII scrubbing

All events pass through `src/lib/scrubber.ts` via `beforeSend` before
being transmitted to Sentry:
- `Authorization` and all `token`/`signature`/`secret` keys → `[REDACTED]`
- Stellar wallet addresses (G…) in string fields → `[WALLET_REDACTED]`
- User identity set to a hashed (SHA-256 + salt) version of the wallet
  address — pseudonymous, not identifiable

Session replay is **off by default** (`replaysSessionSampleRate: 0`).
Enable it only after a privacy review.
