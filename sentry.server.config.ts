import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./src/lib/scrubber";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,

  release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
  environment: process.env.NEXT_PUBLIC_NETWORK ?? "testnet",

  // Lower trace rate on the server — API routes are called frequently.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  beforeSend: scrubEvent,
  beforeSendTransaction: (event) => scrubEvent(event as Parameters<typeof scrubEvent>[0]),
});
