import { defineRouting } from "next-intl/routing";

/**
 * Locale routing (#116). English is served unprefixed (`/options`) and the
 * other locales are prefixed (`/es/options`, `/pt/options`). The middleware
 * detects the locale from the NEXT_LOCALE cookie, then Accept-Language. It
 * persists the user's switcher choice in that cookie and emits hreflang
 * `Link` headers for every page.
 */
export const locales = ["en", "es", "pt"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
  localeCookie: {
    name: "NEXT_LOCALE",
    // Persist the switcher choice for a year.
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  },
  alternateLinks: true,
});

/** BCP 47 tags used for Intl formatting (numbers, currency, dates). */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  pt: "pt-BR",
};

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
