import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale } from "./routing";

/**
 * Per-request i18n config (#116), loaded by the next-intl plugin in
 * next.config.js.
 *
 * `timeZone` is pinned so that server-rendered and client-rendered dates
 * agree (no hydration mismatch). Market expiries are UTC anyway. Financial
 * precision (price and quantity decimals) still comes from the instrument
 * registry in src/lib/format.ts. Only separators and symbols are localised.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "UTC",
    formats: {
      dateTime: {
        short: { day: "numeric", month: "short", year: "numeric" },
        expiry: { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" },
        time: { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
      },
      number: {
        usd: { style: "currency", currency: "USD" },
        percent: { style: "percent", maximumFractionDigits: 1 },
      },
    },
    // Fail soft in production, loud in development and CI.
    onError(error) {
      if (process.env.NODE_ENV !== "production") console.error(error);
    },
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join(".");
    },
  };
});
