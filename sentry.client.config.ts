import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./src/lib/scrubber";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Tie each event to the git SHA so release health and regressions are
  // tracked per deployment.
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
  environment: process.env.NEXT_PUBLIC_NETWORK ?? "testnet",

  // Sample 20% of traces in production; 100% in non-production for
  // easier debugging.  Performance budget: keeps Sentry's overhead low
  // for high-frequency chain polling and WS ticks.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

  // Session replay OFF by default — privacy review required before enabling.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Route Sentry requests through a Next.js tunnel endpoint so ad-blockers
  // that block sentry.io don't silently drop all error reports.
  tunnel: "/api/sentry-tunnel",

  // Source maps are uploaded in CI (see .github/workflows/ci.yml) and NOT
  // served publicly.  The `hideSourceMaps` setting in next.config.js ensures
  // the .map files are excluded from the production bundle served to users.
  beforeSend: scrubEvent,
  beforeSendTransaction: (event) => scrubEvent(event as Parameters<typeof scrubEvent>[0]),
});
