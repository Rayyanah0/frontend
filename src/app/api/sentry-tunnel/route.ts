/**
 * GET/POST /api/sentry-tunnel
 *
 * Proxies Sentry events through the Next.js server so ad-blockers that
 * block direct requests to sentry.io don't silently drop error reports.
 *
 * The @sentry/nextjs SDK handles routing automatically when `tunnelRoute`
 * is set in withSentryConfig() — this file just needs to exist as a
 * valid route handler.
 *
 * See: https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 */
export { default } from "@sentry/nextjs/tunnel";
