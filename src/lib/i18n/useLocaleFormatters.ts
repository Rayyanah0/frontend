"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import { useFormatters } from "../format";
import { INTL_LOCALE, isLocale } from "../../i18n/routing";

/**
 * Instrument-aware formatters for the active locale (#116). Server and
 * client resolve the same locale from the URL, so numbers render the same
 * in SSR and hydration. Use next-intl's `useFormatter()` for dates: its
 * timeZone is pinned to UTC in src/i18n/request.ts.
 */
export function useLocaleFormatters() {
  const locale = useLocale();
  const intlLocale = isLocale(locale) ? INTL_LOCALE[locale] : INTL_LOCALE.en;
  const formatters = useFormatters(intlLocale);
  return useMemo(() => formatters, [intlLocale]); // eslint-disable-line react-hooks/exhaustive-deps
}
